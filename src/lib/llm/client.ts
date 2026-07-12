import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { getDb, llmUsage } from "@/lib/db";

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
  if (provider === "anthropic") return runAnthropicText(call);
  if (call.imageBase64 && provider === "deepseek") {
    throw new Error(
      `Модель «${call.model}» не принимает изображения — выберите в настройках vision-модель (Haiku/Gemini).`,
    );
  }
  return runOpenAiText(call, provider);
}

async function runAnthropicText(call: LlmCall): Promise<string> {
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
    const stream = anthropic.messages.stream(
      {
        model: call.model,
        max_tokens: call.maxTokens ?? 8192,
        system: call.system,
        messages: [{ role: "user", content }],
      },
      // жёсткий потолок: подвисший стрим не держит кнопку «Claude пишет…» бесконечно
      { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) },
    );
    const message = await stream.finalMessage();
    await recordUsage(call, message.usage);
    return message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(
        `Claude не ответил за ${Math.round(LLM_TIMEOUT_MS / 1000)} с — попробуйте ещё раз или выберите модель Haiku (быстрее).`,
      );
    }
    throw e;
  }
}

async function runOpenAiText(call: LlmCall, provider: Provider): Promise<string> {
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
        messages: [
          { role: "system", content: call.system },
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
    if (usage) await recordUsage(call, usage);
    return text;
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

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
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
