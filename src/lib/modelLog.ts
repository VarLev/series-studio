/**
 * Журнал обращений к моделям для вкладки «Console»: что и в каком виде было
 * отправлено в модель и что пришло в ответ. Пишется на двух воронках —
 * текстовые LLM-вызовы (client.runText) и постановка задач генерации
 * видео/картинок (generation.ts). Запись НИКОГДА не должна ронять основной поток.
 */
import { desc, sql } from "drizzle-orm";
import { getDb, modelLog } from "@/lib/db";

export interface LogRef {
  id: string;
  caption?: string;
  role?: string | null;
}

export interface ModelLogInput {
  channel: "llm" | "video" | "image";
  kind: string;
  provider: string;
  model: string;
  status: "ok" | "error";
  /** что ушло в модель: {system,user,prompt,params,hasImage,…} */
  request: Record<string, unknown>;
  /** что пришло: {text} | {jobId} | {error} */
  response: Record<string, unknown>;
  refs?: LogRef[];
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  episodeId?: string | null;
  shotId?: string | null;
}

// потолок журнала — не растим таблицу бесконечно
const MAX_ROWS = 1000;
// длинные строки (system-промпты) режем, чтобы JSON остался валидным и лёгким
const MAX_STR = 24_000;

function truncatingReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_STR) {
    return value.slice(0, MAX_STR) + `\n…[+${value.length - MAX_STR} символов обрезано]`;
  }
  return value;
}

export async function logModelCall(input: ModelLogInput): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(modelLog).values({
      id: crypto.randomUUID(),
      channel: input.channel,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      status: input.status,
      requestJson: JSON.stringify(input.request, truncatingReplacer),
      responseJson: JSON.stringify(input.response, truncatingReplacer),
      refsJson: JSON.stringify(input.refs ?? []),
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      durationMs: input.durationMs ?? 0,
      episodeId: input.episodeId ?? null,
      shotId: input.shotId ?? null,
    });
    // изредка подрезаем хвост журнала (дёшево на объёмах PGlite)
    if (Math.random() < 0.05) {
      await db.execute(
        sql.raw(
          `DELETE FROM model_log WHERE id NOT IN (SELECT id FROM model_log ORDER BY created_at DESC LIMIT ${MAX_ROWS})`,
        ),
      );
    }
  } catch {
    // журнал не должен ломать основной поток
  }
}

export type ModelLogRow = typeof modelLog.$inferSelect;

export async function readModelLog(limit = 200): Promise<ModelLogRow[]> {
  const db = await getDb();
  return db.select().from(modelLog).orderBy(desc(modelLog.createdAt)).limit(limit);
}

export async function clearModelLog(): Promise<void> {
  const db = await getDb();
  await db.execute(sql.raw("DELETE FROM model_log"));
}
