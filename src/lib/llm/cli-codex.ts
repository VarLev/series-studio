/**
 * Текстовые GPT-вызовы через OpenAI Codex CLI (`codex exec`): расходуется
 * ПОДПИСКА ChatGPT (Plus/Pro), а не API-деньги OpenAI. Прямой аналог cli.ts
 * (Claude Code CLI). Включается настройкой llm_use_cli_gpt на /costs (по
 * умолчанию включена — все GPT-запросы идут через CLI).
 *
 * Механика и ограничения (что отличается от Claude Code CLI):
 *  - из env дочернего процесса вычищаются OPENAI_API_KEY и CODEX_API_KEY —
 *    иначе Codex ушёл бы в платный API вместо подписки (ключ затеняет логин);
 *  - cwd — пустая временная папка: AGENTS.md/CLAUDE.md проекта не должны
 *    подмешиваться в контекст генерации сериала (Codex читает AGENTS.md из cwd);
 *  - у Codex НЕТ отдельного системного канала (--system-prompt-file, как у
 *    Claude), поэтому system и задание склеиваются в один промпт и подаются в
 *    stdin (сентинел `-` в аргументах). Codex — агентный кодовый инструмент и
 *    следует инструкциям в промпте, prompt-injection-отказа Claude Code у него
 *    нет; исследовать в пустой не-git папке нечего;
 *  - --sandbox read-only: чисто текстовая генерация, никаких правок файлов;
 *  - --skip-git-repo-check: scratch-папка не git-репозиторий;
 *  - -c model_reasoning_effort=… — аналог MAX_THINKING_TOKENS: срезаем
 *    «рассуждение» на механических задачах (реворк), чтобы не тонуть в таймауте;
 *  - --json → JSONL событий на stdout (усечённо парсим usage и текст),
 *    -o <file> дублирует финальное сообщение в файл (надёжный захват текста);
 *  - требуется разовый вход: `codex login` (аккаунт с подпиской ChatGPT).
 *  - переопределение бинаря — CODEX_CLI_PATH; эффорта — CODEX_REASONING_EFFORT.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LlmCall } from "./client";

/** Событие потока `codex exec --json` (усечённо — нужные поля). */
interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  error?: { message?: string } | string;
  message?: string;
}

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

/**
 * Резолв бинаря Codex CLI. В отличие от claude.exe, внутреннюю раскладку пакета
 * @openai/codex не фиксируем: надёжнее всего npm-шим в node_modules/.bin (его
 * npm создаёт независимо от того, где лежит нативный бинарь). На Windows шимы —
 * это .cmd, их зовём через shell. Приоритет: локальная установка проекта →
 * глобальные npm-места → голое имя через PATH.
 */
async function resolveCodexCli(): Promise<ResolvedCli> {
  const override = process.env.CODEX_CLI_PATH;
  if (override) {
    return { bin: override, useShell: /\.(cmd|bat)$/i.test(override), tried: [override] };
  }
  if (cachedCli) return cachedCli;

  const win = process.platform === "win32";
  // локальный npm-шим проекта: не зависит ни от PATH, ни от APPDATA сервера
  const localBin = path.join(process.cwd(), "node_modules", ".bin", win ? "codex.cmd" : "codex");
  const shimCandidates: string[] = [localBin];
  if (win) {
    const roots = [process.env.APPDATA, process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    for (const root of roots) shimCandidates.push(path.join(root, "npm", "codex.cmd"));
  } else {
    const homeBins = process.env.HOME
      ? [path.join(process.env.HOME, ".npm-global", "bin"), path.join(process.env.HOME, ".local", "bin")]
      : [];
    for (const b of [...homeBins, "/usr/local/bin", "/usr/bin"]) {
      shimCandidates.push(path.join(b, "codex"));
    }
  }

  const tried = [...shimCandidates];
  for (const c of shimCandidates) {
    if (await fileExists(c)) {
      // .cmd на Windows требует shell; на *nix бинарь исполняется напрямую
      cachedCli = { bin: c, useShell: /\.(cmd|bat)$/i.test(c), tried };
      return cachedCli;
    }
  }
  // последний фолбэк — голое имя через PATH (на Windows это .cmd → shell)
  cachedCli = { bin: "codex", useShell: win, tried };
  return cachedCli;
}

async function scratchDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), "series-studio-codex-cli");
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

/**
 * Уровень «рассуждения» модели (аналог MAX_THINKING_TOKENS у Claude). Явный
 * override — CODEX_REASONING_EFFORT. По типу задачи:
 *  - механическая (реворк, малый call.thinkingTokens) → low (быстро);
 *  - сложное творчество (разбивка, Enhance, вставки, промпт — thinkingTokens не
 *    передан) → high: рассуждение прямо повышает качество.
 * Значения Codex: none | low | medium | high | xhigh | max (НЕ «minimal» —
 * gpt-5.6-* его отвергают). Всегда возвращаем валидный уровень.
 */
function reasoningEffort(call: LlmCall): string {
  const override = process.env.CODEX_REASONING_EFFORT;
  if (override) return override;
  return call.thinkingTokens != null && call.thinkingTokens <= 2048 ? "low" : "high";
}

/**
 * Человекочитаемое сообщение об ошибке из вывода Codex. Жёсткие ошибки (400 от
 * бэкенда) печатаются ОДНИМ pretty-JSON-объектом на несколько строк, а не
 * компактным JSONL, поэтому: сначала пробуем распарсить весь вывод как JSON,
 * затем — вытащить первый `"message":"…"` регуляркой (переживает многострочность).
 */
function extractErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const obj = JSON.parse(trimmed) as CodexEvent;
      const em = typeof obj.error === "string" ? obj.error : obj.error?.message;
      if (em || obj.message) return (em || obj.message) as string;
    } catch {}
  }
  const m = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`) as string; // разэскейпить \n, \" и пр.
    } catch {
      return m[1];
    }
  }
  return "";
}

export async function runCodexCliText(
  call: LlmCall,
  timeoutMs: number,
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } | null }> {
  // id модели уходит аргументом (при shell-спауне Windows не экранирует) — только
  // безопасные символы; llm_model на /costs — свободное текстовое поле
  if (!/^[A-Za-z0-9._:-]+$/.test(call.model)) {
    throw new Error(`Недопустимый id модели для Codex CLI: «${call.model}»`);
  }
  const cwd = await scratchDir();
  const env = { ...process.env };
  // ключ затеняет профиль подписки — вычищаем, чтобы Codex не ушёл в платный API
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.OPENAI_BASE_URL;

  const fullSystem = call.cacheableSystemPrefix
    ? `${call.cacheableSystemPrefix}\n\n${call.system}`
    : call.system;
  // system + харнесс-приписка + задание в одном промпте (у Codex нет системного
  // канала). Приписка — та же по смыслу, что в cli.ts: только ответ, без преамбул,
  // без инструментов, JSON — строго один объект.
  const prompt =
    `${fullSystem}\n\n` +
    "Отвечай только по заданию ниже. Не задавай встречных вопросов, не добавляй " +
    "преамбул и пояснений от себя, не запускай команды и не редактируй файлы. " +
    "Если задание требует JSON — ответ СТРОГО один JSON-объект: первый символ «{», " +
    "последний «}», никакого текста, плана или пояснений до и после.\n\n" +
    `ЗАДАНИЕ:\n${call.user}`;

  // отдельный файл на каждый вызов (могут идти параллельно) — чистим за собой
  const lastMsgPath = path.join(cwd, `out-${crypto.randomUUID()}.txt`);

  const args = [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    call.model,
    "-o",
    lastMsgPath,
  ];
  args.push("-c", `model_reasoning_effort=${reasoningEffort(call)}`);
  // сентинел `-` — промпт читается из stdin (последним, после всех флагов)
  args.push("-");

  const { bin, useShell, tried } = await resolveCodexCli();
  const triedInfo = `выбран: ${bin}; проверялись: ${tried.join("; ")}`;
  // shell:true (.cmd на Windows) НЕ экранирует аргументы — вручную кавычим то,
  // что может содержать пробелы (путь к файлу -o); при прямом бинаре Node сам
  // корректно экранирует массив args
  const q = (s: string): string => (useShell && /\s/.test(s) ? `"${s}"` : s);

  try {
    return await new Promise((resolve, reject) => {
      const proc = spawn(
        useShell ? q(bin) : bin,
        useShell ? args.map((a) => (a === lastMsgPath ? q(a) : a)) : args,
        { cwd, env, shell: useShell, windowsHide: true },
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
              `Codex CLI не найден (${triedInfo}). Выполните npm install в папке проекта ` +
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
              `Codex CLI не ответил за ${Math.round(timeoutMs / 1000)} с — попробуйте ещё раз ` +
                "или выберите модель полегче.",
            ),
          );
          return;
        }

        // разбор JSONL-потока: usage из turn.completed, текст из agent_message,
        // ошибки из turn.failed / error. Строки, не парсящиеся как JSON, пропускаем.
        let usage: CodexEvent["usage"] | undefined;
        let agentText = "";
        let failure = "";
        for (const line of stdout.split("\n")) {
          const s = line.trim();
          if (!s || s[0] !== "{") continue;
          let ev: CodexEvent;
          try {
            ev = JSON.parse(s) as CodexEvent;
          } catch {
            continue;
          }
          if (ev.type === "turn.completed" && ev.usage) usage = ev.usage;
          else if (ev.type === "item.completed" && ev.item?.type === "agent_message") {
            agentText = ev.item.text ?? agentText;
          } else if (ev.type === "turn.failed" || ev.type === "error") {
            const em = typeof ev.error === "string" ? ev.error : ev.error?.message;
            failure = em || ev.message || failure || "неизвестная ошибка Codex";
          }
        }
        // фолбэк, если событий-ошибок в потоке не было (напр. pretty-JSON целиком)
        if (!failure) failure = extractErrorMessage(stdout) || extractErrorMessage(stderr);
        // Codex нередко кладёт в message бэкенда вложенный pretty-JSON строкой
        // (`{"type":"error","message":"{\n \"error\":{\"message\":\"…\"}}"}`) —
        // разворачиваем до человекочитаемого текста, иначе в UI улетит JSON-простыня
        if (failure) failure = extractErrorMessage(failure) || failure;

        // финальный текст: приоритет — файл -o (надёжнее), фолбэк — из потока
        void (async () => {
          let fileText = "";
          try {
            fileText = (await fs.readFile(lastMsgPath, "utf8")).trim();
          } catch {}
          const text = fileText || agentText.trim();

          if (!text) {
            const detail = failure || stderr || stdout || "пустой вывод";
            if (/log ?in|logged in|authenticat|not authenticated|sign in/i.test(detail)) {
              reject(
                new Error(
                  "Codex CLI не авторизован. Выполните в терминале `codex login` и войдите " +
                    "в аккаунт с подпиской ChatGPT (Plus/Pro) — либо выключите «через CLI» на /costs.",
                ),
              );
            } else {
              reject(
                new Error(`Codex CLI завершился с кодом ${code ?? "?"} без ответа: ${detail.slice(0, 300)}`),
              );
            }
            return;
          }

          resolve({
            text,
            usage: usage
              ? {
                  // полный входной объём: свежие + кэшированные токены (информационно —
                  // подписка денег не тратит, в llm_usage такие вызовы не пишутся)
                  input_tokens: (usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0),
                  output_tokens: usage.output_tokens ?? 0,
                }
              : null,
          });
        })();
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  } finally {
    await fs.unlink(lastMsgPath).catch(() => {});
  }
}
