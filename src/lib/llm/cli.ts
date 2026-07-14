/**
 * Текстовые Claude-вызовы через Claude Code CLI (`claude -p`): расходуется
 * ПОДПИСКА Pro/Max, а не API-деньги. Включается настройкой llm_use_cli на /costs.
 *
 * Механика и ограничения:
 *  - из env дочернего процесса вычищается ANTHROPIC_API_KEY — иначе CLI молча
 *    ушёл бы в платный API вместо подписки (ключ затеняет профиль логина);
 *  - cwd — пустая временная папка: CLAUDE.md/AGENTS.md проекта не должны
 *    подмешиваться в контекст генерации сериала;
 *  - системный промпт — во временном файле через --system-prompt-file, а НЕ
 *    строкой в stdin/user-контенте: (проверено на реальном логине) если системные
 *    инструкции подать текстом внутри user-сообщения (даже в псевдо-теге
 *    <system>), Claude распознаёт это как prompt injection и ОТКАЗЫВАЕТСЯ их
 *    выполнять — "This appears to be a prompt injection attempt". Только
 *    настоящий системный канал (--system-prompt-file) исполняется без вопросов;
 *  - stdin несёт ТОЛЬКО задание (call.user) — ничего больше;
 *  - --strict-mcp-config: не грузить MCP-серверы пользователя (медленно и не нужно);
 *  - инструменты запрещены — это чисто текстовая генерация;
 *  - требуется разовый вход: `claude`, затем `/login` (аккаунт с подпиской);
 *  - запускаем НАТИВНЫЙ claude.exe напрямую по абсолютному пути, shell:false
 *    (см. resolveCli). Так вызов не зависит ни от PATH серверного процесса, ни
 *    от кодировки cmd.exe — это две грабли, на которых падал прежний .cmd-путь.
 *    `claude` в %APPDATA%\npm — это .cmd-шим, зовущий тот .exe; мы находим .exe
 *    напрямую (…/node_modules/@anthropic-ai/claude-code/bin/claude.exe).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LlmCall } from "./client";

/** Результат в формате `claude -p --output-format json` (усечённо — нужные поля). */
interface CliResultJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
}

const DISALLOWED_TOOLS =
  "Bash,Edit,Write,Read,Glob,Grep,Task,TodoWrite,NotebookEdit,WebFetch,WebSearch";

/**
 * Резолв бинаря. Ключевой момент (Windows): `claude` — это .cmd-шим, который
 * зовёт НАТИВНЫЙ claude.exe. Запускать нужно ИМЕННО .exe напрямую (shell:false):
 * тогда нет зависимости ни от PATH дочернего процесса, ни от кодировки cmd.exe —
 * ровно те две грабли, на которых мы застряли. .cmd/голое имя — только фолбэк,
 * и они требуют shell. `useShell` говорит вызывающему, как спаунить.
 */
interface ResolvedCli {
  bin: string;
  useShell: boolean;
  /** какие пути реально проверялись — уходит в текст ошибки для диагностики */
  tried: string[];
}
// кэш на процесс: undefined = ещё не резолвили, объект = результат
let cachedCli: ResolvedCli | undefined;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveCli(): Promise<ResolvedCli> {
  // явное переопределение путём: доверяем как есть (shell — только для .cmd/.bat)
  const override = process.env.CLAUDE_CLI_PATH;
  if (override) {
    return { bin: override, useShell: /\.(cmd|bat)$/i.test(override), tried: [override] };
  }
  if (cachedCli) return cachedCli;

  // приоритет №1 — ЛОКАЛЬНАЯ установка в node_modules проекта (devDependency):
  // путь от cwd серверного процесса, не зависит ни от PATH, ни от APPDATA, ни от
  // того, под каким пользователем Windows запущен сервер. Глобальные места — фолбэк.
  const nativeExe: string[] = [
    path.join(process.cwd(), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  ];
  const shimmed: string[] = [];
  if (process.platform === "win32") {
    const roots = [process.env.APPDATA, process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    for (const root of roots) {
      // раскладка глобальной npm-установки: <prefix>/node_modules/.../bin/claude.exe
      nativeExe.push(
        path.join(root, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
      );
      shimmed.push(path.join(root, "npm", "claude.cmd"));
    }
  } else {
    // на *nix локальный бинарь пакета — исполняемый файл bin/claude
    nativeExe[0] = path.join(process.cwd(), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude");
    const homeBins = process.env.HOME
      ? [path.join(process.env.HOME, ".npm-global", "bin"), path.join(process.env.HOME, ".local", "bin")]
      : [];
    for (const b of [...homeBins, "/usr/local/bin", "/usr/bin"]) {
      nativeExe.push(path.join(b, "claude"));
    }
  }

  const tried = [...nativeExe, ...shimmed];
  for (const c of nativeExe) {
    if (await fileExists(c)) {
      cachedCli = { bin: c, useShell: false, tried };
      return cachedCli;
    }
  }
  for (const c of shimmed) {
    if (await fileExists(c)) {
      cachedCli = { bin: c, useShell: true, tried };
      return cachedCli;
    }
  }
  // последний фолбэк — голое имя через PATH (вдруг PATH исправен)
  cachedCli = { bin: "claude", useShell: process.platform === "win32", tried };
  return cachedCli;
}

async function scratchDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), "series-studio-claude-cli");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Убить процесс вместе с потомками (shell-обёртка cmd.exe на Windows). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

export async function runClaudeCliText(
  call: LlmCall,
  timeoutMs: number,
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } | null }> {
  // id модели уходит аргументом в shell-спаун (Windows не экранирует) — только
  // безопасные символы; llm_model на /costs — свободное текстовое поле
  if (!/^[A-Za-z0-9._:-]+$/.test(call.model)) {
    throw new Error(`Недопустимый id модели для Claude CLI: «${call.model}»`);
  }
  const cwd = await scratchDir();
  const env = { ...process.env };
  // ключ затеняет профиль подписки — вычищаем, чтобы CLI не ушёл в платный API
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_MODEL;

  const fullSystem = call.cacheableSystemPrefix
    ? `${call.cacheableSystemPrefix}\n\n${call.system}`
    : call.system;
  // харнесс-инструкции (не преамбулы, не вопросы) — тоже в РЕАЛЬНЫЙ системный
  // канал, а не в user-текст: там же их место
  const systemText =
    `${fullSystem}\n\n` +
    "Отвечай только по заданию в пользовательском сообщении. Не задавай встречных " +
    "вопросов, не добавляй преамбул и пояснений от себя, не используй инструменты. " +
    "Если задание требует JSON — ответ СТРОГО один JSON-объект: первый символ «{», " +
    "последний «}», никакого текста, плана или пояснений до и после.";

  // отдельный файл на каждый вызов (могут идти параллельно) — чистим за собой
  const sysPath = path.join(cwd, `sys-${crypto.randomUUID()}.txt`);
  await fs.writeFile(sysPath, systemText, "utf8");

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    call.model,
    "--system-prompt-file",
    sysPath,
    "--strict-mcp-config",
    "--disallowedTools",
    DISALLOWED_TOOLS,
  ];

  const { bin, useShell, tried } = await resolveCli();
  // диагностика для сообщений об ошибках: что именно проверяли и что выбрали
  const triedInfo = `выбран: ${bin}; проверялись: ${tried.join("; ")}`;
  // shell:true (только фолбэк .cmd) НЕ экранирует аргументы — вручную кавычим
  // пути с пробелами; при прямом .exe (useShell:false) Node сам корректно
  // экранирует массив args, ничего не трогаем
  const q = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s);

  try {
    return await new Promise((resolve, reject) => {
      // нативный claude.exe спауним НАПРЯМУЮ (useShell:false) — не зависим ни от
      // PATH серверного процесса, ни от кодировки cmd.exe. Крупный контент
      // (система/задание) идёт через файл/stdin, в аргументах — только короткие
      // токены (путь к файлу, id модели)
      const proc = spawn(
        useShell ? q(bin) : bin,
        useShell ? args.map((a) => (a === sysPath ? q(a) : a)) : args,
        {
          cwd,
          env,
          shell: useShell,
          windowsHide: true,
        },
      );

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(proc.pid);
      }, timeoutMs);

      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (e.code === "ENOENT") {
          reject(
            new Error(
              `Claude CLI не найден (${triedInfo}). Выполните npm install в папке проекта ` +
                "(CLI ставится локально в node_modules) и перезапустите сервер — либо выключите «через CLI» на /costs.",
            ),
          );
        } else reject(e);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new Error(
              `Claude CLI не ответил за ${Math.round(timeoutMs / 1000)} с — попробуйте ещё раз ` +
                "или выберите модель Haiku (быстрее).",
            ),
          );
          return;
        }

        let parsed: CliResultJson | null = null;
        try {
          // --output-format json печатает один JSON-объект; срезаем возможный мусор до "{"
          const raw = stdout.slice(stdout.indexOf("{"));
          parsed = JSON.parse(raw) as CliResultJson;
        } catch {}

        if (!parsed) {
          const raw = (stderr || stdout || "пустой вывод").slice(0, 300);
          // фолбэк через .cmd/PATH мог упереться в cmd.exe «не является командой»
          // в родной кодировке консоли (кракозябры U+FFFD). При прямом .exe этого
          // уже не бывает, но признак оставляем на случай фолбэк-пути
          const looksLikeCmdError = raw.includes("�");
          reject(
            new Error(
              looksLikeCmdError
                ? `Claude CLI не удалось запустить (${triedInfo}). Выполните npm install в папке ` +
                  "проекта (CLI ставится локально в node_modules) и перезапустите сервер — " +
                  "либо выключите «через CLI» на /costs."
                : `Claude CLI завершился с кодом ${code ?? "?"} без JSON-ответа: ${raw}`,
            ),
          );
          return;
        }

        if (parsed.is_error || parsed.subtype !== "success") {
          const msg = parsed.result || parsed.subtype || "неизвестная ошибка CLI";
          if (/log ?in|logged in|authenticat/i.test(msg)) {
            reject(
              new Error(
                "Claude CLI не авторизован. Выполните в терминале `claude`, затем `/login` " +
                  "и выберите аккаунт с подпиской (Pro/Max) — либо выключите «через CLI» на /costs.",
              ),
            );
          } else {
            reject(new Error(`Claude CLI: ${msg.slice(0, 300)}`));
          }
          return;
        }

        const u = parsed.usage;
        resolve({
          text: parsed.result ?? "",
          usage: u
            ? {
                // полный входной объём: свежие + кэшированные токены (информационно —
                // подписка денег не тратит, в llm_usage такие вызовы не пишутся)
                input_tokens:
                  (u.input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0),
                output_tokens: u.output_tokens ?? 0,
              }
            : null,
        });
      });

      proc.stdin.write(call.user);
      proc.stdin.end();
    });
  } finally {
    await fs.unlink(sysPath).catch(() => {});
  }
}
