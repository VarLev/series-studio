"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, prompts, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { llmShotPrompt, llmRevisePrompt } from "@/lib/llm/factory";
import { collapseAt } from "@/lib/entityName";
import type { ShotPrompt } from "@/lib/llm/contracts";

type Result = { ok: true; promptId: string } | { ok: false; error: string };

async function nextVersion(shotId: string): Promise<number> {
  const db = await getDb();
  const [last] = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version))
    .limit(1);
  return (last?.version ?? 0) + 1;
}

async function insertVersion(
  shotId: string,
  targetModel: string,
  data: ShotPrompt,
  parentId: string | null,
  feedbackNote: string | null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(prompts).values({
    id,
    shotId,
    version: await nextVersion(shotId),
    parentId,
    targetModel,
    // @@Craig → @Craig: element_name уже содержит @, модель могла задвоить
    text: collapseAt(data.prompt),
    negativePrompt: data.negative_prompt ? collapseAt(data.negative_prompt) : null,
    paramsJson: JSON.stringify({
      ...data.params,
      reference_element_names: data.reference_element_names,
      techniques: data.used_technique_ids,
    }),
    feedbackNote,
  });
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot && shot.status === "draft") {
    await db.update(shots).set({ status: "prompted" }).where(eq(shots.id, shotId));
  }
  if (shot) {
    revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
    revalidatePath(`/episodes/${shot.episodeId}`);
  }
  return id;
}

/**
 * Лёгкий опрос: номер последней версии промпта шота (0 — промпта нет). Клиент
 * поллит его во время генерации, чтобы подхватить результат, даже если ответ
 * долгого запроса потерялся в туннеле (самовосстановление UI). Без ревалидации.
 */
export async function latestPromptVersion(shotId: string): Promise<number> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select({ version: prompts.version })
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version))
    .limit(1);
  return row?.version ?? 0;
}

/** U2 — сгенерировать промпт шота (промпт-фабрика). llmModel — какая ИИ пишет промпт. */
export async function generateShotPrompt(
  shotId: string,
  targetModel: string,
  llmModel?: string,
): Promise<Result> {
  await requireAuth();
  try {
    const data = await llmShotPrompt(shotId, targetModel, llmModel);
    const promptId = await insertVersion(shotId, targetModel, data, null, null);
    return { ok: true, promptId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** U4 — замечание → версия N+1 через промпт-фабрику. */
export async function revisePrompt(promptId: string, feedback: string): Promise<Result> {
  await requireAuth();
  try {
    const db = await getDb();
    const [prev] = await db.select().from(prompts).where(eq(prompts.id, promptId));
    if (!prev) return { ok: false, error: "Промпт не найден" };
    const data = await llmRevisePrompt(promptId, feedback);
    // приёмы прошлой версии не теряются, если ревизия не выбрала свои
    if (!data.used_technique_ids.length) {
      const prevParams = JSON.parse(prev.paramsJson || "{}") as { techniques?: string[] };
      data.used_technique_ids = prevParams.techniques ?? [];
    }
    const newId = await insertVersion(prev.shotId, prev.targetModel, data, promptId, feedback);
    return { ok: true, promptId: newId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Ручная правка: сохранить текст как новую версию без LLM. */
export async function saveManualVersion(
  promptId: string,
  text: string,
  note: string,
): Promise<Result> {
  await requireAuth();
  const db = await getDb();
  const [prev] = await db.select().from(prompts).where(eq(prompts.id, promptId));
  if (!prev) return { ok: false, error: "Промпт не найден" };
  const params = JSON.parse(prev.paramsJson || "{}");
  const newId = await insertVersion(
    prev.shotId,
    prev.targetModel,
    {
      prompt: text,
      negative_prompt: prev.negativePrompt ?? "",
      reference_element_names: params.reference_element_names ?? [],
      used_technique_ids: params.techniques ?? [],
      params: { aspect_ratio: params.aspect_ratio ?? "16:9", duration: params.duration ?? 15 },
    },
    promptId,
    note || "Ручная правка",
  );
  return { ok: true, promptId: newId };
}
