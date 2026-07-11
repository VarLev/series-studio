import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getDb, llmUsage } from "@/lib/db";

let client: Anthropic | null = null;

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

/** Жёсткий потолок ожидания ответа модели (мс). Переопределяется LLM_TIMEOUT_MS. */
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 180_000;

export interface LlmCall {
  kind: "synopsis" | "breakdown" | "prompt" | "revision";
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  episodeId?: string;
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
  const anthropic = getClient();
  try {
    const stream = anthropic.messages.stream(
      {
        model: call.model,
        max_tokens: call.maxTokens ?? 8192,
        system: call.system,
        messages: [{ role: "user", content: call.user }],
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
