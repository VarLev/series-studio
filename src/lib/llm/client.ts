import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { getDb, llmUsage } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { logModelCall } from "@/lib/modelLog";
import { runClaudeCliText } from "./cli";

let client: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY не задан — генерация текста недоступна. Добавьте ключ в .env.local.",
    );
  }
  // maxRetries:1 — стрим-запрос, зависший на сети, иначе молча ретраится дважды
  // (дефолт 2), и кнопка «Claude пишет…» висит до timeout×3 ≈ получаса.
  if (!client) client = new Anthropic({ maxRetries: 1 });
  return client;
}

function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY не задан — для моделей GPT добавьте ключ OpenAI в .env.local " +
        "или выберите модель Claude.",
    );
  }
  if (!openaiClient) openaiClient = new OpenAI({ maxRetries: 1 });
  return openaiClient;
}

/** DeepSeek: OpenAI-совместимый API (api.deepseek.com), ключ DEEPSEEK_API_KEY. */
function getDeepSeek(): OpenAI {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY не задан — для моделей DeepSeek добавьте ключ в .env.local " +
        "(https://platform.deepseek.com) или выберите другую модель в настройках.",
    );
  }
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
      maxRetries: 1,
    });
  }
  return deepseekClient;
}

/** Gemini-текст: OpenAI-совместимый эндпоинт Google, тот же GEMINI_API_KEY, что и Nano Banana. */
function getGemini(): OpenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY не задан — для моделей Gemini добавьте ключ Google AI Studio в .env.local " +
        "или выберите другую модель в настройках.",
    );
  }
  if (!geminiClient) {
    geminiClient = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      maxRetries: 1,
    });
  }
  return geminiClient;
}

type Provider = "anthropic" | "openai" | "deepseek" | "gemini";

/** Маршрутизация по id: gpt/o-серия → OpenAI, deepseek → DeepSeek, gemini → Google, остальное — Anthropic. */
function providerOf(model: string): Provider {
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return "openai";
  if (/^deepseek/i.test(model)) return "deepseek";
  if (/^gemini/i.test(model)) return "gemini";
  return "anthropic";
}

function openAiCompatClient(provider: Provider): OpenAI {
  if (provider === "deepseek") return getDeepSeek();
  if (provider === "gemini") return getGemini();
  return getOpenAI();
}

/** Жёсткий потолок ожидания ответа модели (мс). Переопределяется LLM_TIMEOUT_MS. */
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 180_000;

export interface LlmCall {
  kind: "synopsis" | "breakdown" | "prompt" | "revision" | "analysis";
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  episodeId?: string;
  /** vision: изображение для анализа (base64 без префикса data:) */
  imageBase64?: string;
  imageMediaType?: string;
  /** id референсов, приложенных к вызову (для журнала «Console») */
  refIds?: string[];
  /**
   * Часть system-промпта, не зависящая от конкретного вызова (шаблон, правила
   * сериала, индекс библиотеки приёмов) — идёт ПЕРЕД `system` отдельным блоком
   * с cache_control (Anthropic prompt caching: повторные вызовы в рамках одного
   * эпизода платят за неё только один раз вместо каждого шота). У OpenAI-совместимых
   * провайдеров кэш срабатывает автоматически на совпадающий префикс — здесь просто
   * склеивается перед `system`.
   */
  cacheableSystemPrefix?: string;
  /**
   * Принудительно гнать вызов через Claude Code CLI (подписка), не спрашивая
   * настройку llm_use_cli. Для операций, которые ВСЕГДА идут через подписку
   * (Enhance на Opus). Работает только для Claude-моделей без картинки.
   */
  forceCli?: boolean;
  /**
   * Бюджет «мышления» для CLI-вызова (env MAX_THINKING_TOKENS дочернего процесса).
   * По умолчанию Claude Code думает щедро (~12k токенов → 170–210с и таймауты).
   * Для механических задач (реворк раскадровки) ставим 0 — вызов ускоряется в разы
   * без потери качества. Не задан → поведение CLI по умолчанию (для Enhance/промптов).
   */
  thinkingTokens?: number;
}

function fullSystemText(call: LlmCall): string {
  return call.cacheableSystemPrefix ? `${call.cacheableSystemPrefix}\n\n${call.system}` : call.system;
}

interface TextResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number } | null;
}

async function recordUsage(
  call: LlmCall,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(llmUsage).values({
      id: crypto.randomUUID(),
      kind: call.kind,
      model: call.model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      episodeId: call.episodeId ?? null,
    });
  } catch {
    // usage accounting must never break the main flow
  }
}

export async function runText(call: LlmCall): Promise<string> {
  const provider = providerOf(call.model);
  if (call.imageBase64 && provider === "deepseek") {
    throw new Error(
      `Модель «${call.model}» не принимает изображения — выберите в настройках vision-модель (Haiku/Gemini).`,
    );
  }
  // Claude-текст через Claude Code CLI (подписка вместо API), если включено в
  // настройках ИЛИ вызов помечен forceCli (Enhance). Vision — всегда API: CLI
  // не принимает картинку из памяти.
  const viaCli =
    provider === "anthropic" &&
    !call.imageBase64 &&
    (call.forceCli || (await getSetting("llm_use_cli")) === "1");
  const loggedProvider = viaCli ? "anthropic-cli" : provider;
  const started = Date.now();
  const refs = (call.refIds ?? []).map((id) => ({ id }));
  try {
    const { text, usage } = viaCli
      ? // CLI получает больше потолка, чем API: холодный старт процесса + возможное
        // «мышление» модели не должны съедать бюджет. Основной рычаг скорости —
        // срез thinking (MAX_THINKING_TOKENS в cli.ts); этот запас — страховка на
        // случай всё ещё медленного вызова, чтобы не ловить таймаут на 210с.
        await runClaudeCliText(call, LLM_TIMEOUT_MS + 120_000)
      : provider === "anthropic"
        ? await runAnthropicText(call)
        : await runOpenAiText(call, provider);
    // подписка не тратит деньги — CLI-вызовы не попадают в llm_usage (расходы на
    // /costs остаются честными); токены видны в журнале «Console» (model_log)
    if (usage && !viaCli) await recordUsage(call, usage);
    await logModelCall({
      channel: "llm",
      kind: call.kind,
      provider: loggedProvider,
      model: call.model,
      status: "ok",
      request: {
        system: fullSystemText(call),
        user: call.user,
        hasImage: Boolean(call.imageBase64),
        imageMediaType: call.imageBase64 ? call.imageMediaType ?? "image/png" : undefined,
        maxTokens: call.maxTokens,
      },
      response: { text },
      refs,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      durationMs: Date.now() - started,
      episodeId: call.episodeId ?? null,
    });
    return text;
  } catch (e) {
    await logModelCall({
      channel: "llm",
      kind: call.kind,
      provider: loggedProvider,
      model: call.model,
      status: "error",
      request: { system: fullSystemText(call), user: call.user, hasImage: Boolean(call.imageBase64) },
      response: { error: e instanceof Error ? e.message : String(e) },
      refs,
      durationMs: Date.now() - started,
      episodeId: call.episodeId ?? null,
    });
    throw e;
  }
}

async function runAnthropicText(call: LlmCall): Promise<TextResult> {
  const anthropic = getClient();
  try {
    const content: Anthropic.ContentBlockParam[] = call.imageBase64
      ? [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: (call.imageMediaType ?? "image/png") as
                | "image/png"
                | "image/jpeg"
                | "image/webp"
                | "image/gif",
              data: call.imageBase64,
            },
          },
          { type: "text", text: call.user },
        ]
      : [{ type: "text", text: call.user }];
    // videoTemplate+rules (или индекс приёмов) не зависят от конкретного шота —
    // отдельным cache_control блоком ПЕРЕД остальным system, чтобы повторные вызовы
    // в рамках эпизода не платили за него заново (Anthropic prompt caching)
    const system: string | Anthropic.TextBlockParam[] = call.cacheableSystemPrefix
      ? [
          {
            type: "text",
            text: call.cacheableSystemPrefix,
            cache_control: { type: "ephemeral" },
          },
          ...(call.system ? [{ type: "text" as const, text: call.system }] : []),
        ]
      : call.system;
    const stream = anthropic.messages.stream(
      {
        model: call.model,
        max_tokens: call.maxTokens ?? 8192,
        system,
        messages: [{ role: "user", content }],
      },
      // жёсткий потолок: подвисший стрим не держит кнопку «Claude пишет…» бесконечно
      { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
    );
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    };
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(
        `Claude не ответил за ${Math.round(LLM_TIMEOUT_MS / 1000)} с — попробуйте ещё раз или выберите модель Haiku (быстрее).`,
      );
    }
    throw e;
  }
}

async function runOpenAiText(call: LlmCall, provider: Provider): Promise<TextResult> {
  const openai = openAiCompatClient(provider);
  try {
    // vision через OpenAI-совместимый формат: картинка как data-URI (Gemini/GPT)
    const userContent: OpenAI.Chat.ChatCompletionUserMessageParam["content"] = call.imageBase64
      ? [
          {
            type: "image_url",
            image_url: {
              url: `data:${call.imageMediaType ?? "image/png"};base64,${call.imageBase64}`,
            },
          },
          { type: "text", text: call.user },
        ]
      : call.user;
    // GPT-5.x требует max_completion_tokens (max_tokens отклоняется);
    // DeepSeek/Gemini принимают классический max_tokens
    const tokenParam =
      provider === "openai"
        ? { max_completion_tokens: call.maxTokens ?? 8192 }
        : { max_tokens: call.maxTokens ?? 8192 };
    const stream = await openai.chat.completions.create(
      {
        model: call.model,
        ...tokenParam,
        // префикс первым — так совпадающее начало промпта подхватывает автоматическое
        // кэширование провайдера (OpenAI/DeepSeek/Gemini кэшируют по префиксу сами,
        // без явных флагов, в отличие от Anthropic)
        messages: [
          { role: "system", content: fullSystemText(call) },
          { role: "user", content: userContent },
        ],
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
    );
    let text = "";
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? "";
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens,
          output_tokens: chunk.usage.completion_tokens,
        };
      }
    }
    return { text, usage };
  } catch (e) {
    const providerName =
      provider === "deepseek" ? "DeepSeek" : provider === "gemini" ? "Gemini" : "GPT";
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(
        `${providerName} не ответил за ${Math.round(LLM_TIMEOUT_MS / 1000)} с — попробуйте ещё раз или выберите другую модель.`,
      );
    }
    // модель недоступна на аккаунте (напр. новейшая ещё не открыта) — понятная подсказка
    if (e instanceof OpenAI.APIError && (e.status === 404 || e.status === 400)) {
      throw new Error(
        `Модель «${call.model}» недоступна в API ${providerName} (${e.status}). ` +
          "Проверьте доступ к модели или выберите другую модель в настройках.",
      );
    }
    throw e;
  }
}

function isParsableJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Сбалансированные {...}-подстроки верхнего уровня (с учётом строк и эскейпов).
 * Многословный ответ модели (план → JSON → пояснение) содержит несколько
 * кандидатов — вернём их все, выберет вызывающий.
 */
function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      if (depth > 0) inStr = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0 && --depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Достать JSON из ответа модели. Модель может писать прозу/план ВОКРУГ JSON
 * (инцидент Enhance на Opus: первый code-fence — не JSON, а после JSON — текст,
 * из-за чего старый парсер «первый fence или от первой скобки до конца» падал
 * оба раза и runJson делал бесполезный дорогой ретрай). Порядок попыток:
 *  1) валидный JSON среди ВСЕХ fenced-блоков;
 *  2) крупнейший сбалансированный {...} в тексте, который парсится;
 *  3) старое поведение — от первой скобки до конца (последний шанс).
 */
function extractJson(text: string): string {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const f of fences) {
    if (isParsableJson(f)) return f;
  }
  const balanced = balancedObjects(text)
    .filter(isParsableJson)
    .sort((a, b) => b.length - a.length);
  if (balanced[0]) return balanced[0];
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error("Ответ модели не содержит JSON");
  return text.slice(start).trim();
}

/**
 * Structured output per TZ §7: instruct "return only JSON", then validate
 * server-side with zod. One retry with the validation error appended.
 */
export async function runJson<T>(call: LlmCall, schema: z.ZodType<T>): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? call.user
        : `${call.user}\n\nПредыдущий ответ не прошёл валидацию: ${lastError}\nВерни ТОЛЬКО корректный JSON.`;
    const text = await runText({ ...call, user });
    try {
      const parsed = JSON.parse(extractJson(text));
      return schema.parse(parsed);
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 500) : String(e);
    }
  }
  throw new Error(`Модель вернула невалидный JSON: ${lastError}`);
}
