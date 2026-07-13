"use server";

import { asc, desc, eq, sql as dsql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, episodes, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { llmBreakdown } from "@/lib/llm/factory";
import { setSetting } from "@/lib/settings";
import { composeActionMd, normalizeBeats, recomputeEpisodeTimecodes } from "@/lib/beats";
import { buildEntityLinkIndex, linkGroupEntities } from "@/lib/entityLink";
import type { Breakdown } from "@/lib/llm/contracts";

/**
 * Эпизод создаётся ТОЛЬКО когда в черновике появился текст (замечание заказчика:
 * пустая кнопка «Новая серия» плодила пустые эпизоды). Экран /episodes/new
 * держит черновик локально и зовёт это действие при первом непустом вводе.
 */
export async function createEpisodeFromDraft(input: {
  title?: string;
  logline?: string;
  synopsisMd?: string;
}): Promise<string> {
  await requireAuth();
  const db = await getDb();
  const [last] = await db.select().from(episodes).orderBy(desc(episodes.number)).limit(1);
  const id = crypto.randomUUID();
  await db.insert(episodes).values({
    id,
    number: (last?.number ?? 0) + 1,
    title: input.title ?? "",
    logline: input.logline ?? "",
    synopsisMd: input.synopsisMd ?? "",
  });
  revalidatePath("/episodes");
  return id;
}

export async function updateEpisode(
  id: string,
  patch: { title?: string; logline?: string; synopsisMd?: string; status?: string },
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(episodes).set(patch).where(eq(episodes.id, id));
  revalidatePath(`/episodes/${id}`);
  revalidatePath("/episodes");
}

/** Выбор LLM-модели сохраняется сразу при смене в селекте — переживает вкладки и перезагрузку. */
export async function saveLlmModelChoice(model: string): Promise<void> {
  await requireAuth();
  await setSetting("llm_model", model);
}

export async function breakdownEpisode(
  episodeId: string,
  model?: string,
  duration?: { min: number; max: number },
): Promise<{ ok: true; breakdown: Breakdown } | { ok: false; error: string }> {
  await requireAuth();
  try {
    if (model) await setSetting("llm_model", model);
    const db = await getDb();
    const [ep] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!ep) return { ok: false, error: "Эпизод не найден" };
    if (!ep.synopsisMd.trim())
      return { ok: false, error: "Сначала вставьте литературный сюжет во вкладке «Сюжет»" };
    const breakdown = await llmBreakdown(episodeId, ep.synopsisMd, model, duration);
    return { ok: true, breakdown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/**
 * Пользователь подтвердил предпросмотр раскадровки → создаём карточки групп.
 * Spec §2.2: повторный запуск НЕ дублирует готовые группы — по умолчанию новые
 * группы добавляются после существующих (mode="append"); mode="replace" —
 * явная пересборка с нуля.
 */
export async function saveBreakdown(
  episodeId: string,
  breakdown: Breakdown,
  mode: "append" | "replace" = "append",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  // персонажи/локации из ответа модели → сущности библии: по name и element_name,
  // без учёта @ и регистра + скан текста битов (общий хелпер, см. entityLink.ts)
  const linkIndex = await buildEntityLinkIndex();

  const oldShots = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  if (mode === "replace") {
    // глубокий каскад: раньше generations (видео) и референсы старых шотов
    // оставались сиротами с мёртвыми ссылками на удалённые шоты
    const { deleteShotDeep } = await import("@/lib/cascade");
    for (const s of oldShots) await deleteShotDeep(s.id);
  }

  let index =
    mode === "append" ? Math.max(0, ...oldShots.map((s) => s.orderIndex)) + 1 : 1;
  for (const group of [...breakdown.groups].sort((a, b) => a.order - b.order)) {
    const shotId = crypto.randomUUID();
    // время шотов нормализуется от 00:00 (группа = отдельное видео),
    // сквозной таймкод групп пересчитывается ниже по фактическим длительностям
    const { beats, durationSec } = normalizeBeats(group.shots, group.duration_sec);
    await db.insert(shots).values({
      id: shotId,
      episodeId,
      orderIndex: index++,
      title: group.title,
      durationSec,
      beatsJson: JSON.stringify(beats),
      actionMd: composeActionMd(beats, group.title),
      cameraHint: "",
      location: group.location ?? "",
      timeWeather: group.time_weather ?? "",
      emotionalTone: group.emotional_tone ?? "",
      status: "draft",
      sceneStart: group.scene_start,
    });
    await linkGroupEntities(linkIndex, shotId, {
      names: [...group.characters, group.location],
      beatsText: beats
        .map((b) => `${b.framing} ${b.camera} ${b.action} ${b.dialogue}`)
        .join(" "),
      wardrobe: group.wardrobe,
    });
  }
  await recomputeEpisodeTimecodes(episodeId);
  await db.update(episodes).set({ status: "storyboarded" }).where(eq(episodes.id, episodeId));
  revalidatePath(`/episodes/${episodeId}`);
}

export async function listEpisodes() {
  await requireAuth();
  const db = await getDb();
  const eps = await db.select().from(episodes).orderBy(asc(episodes.number));
  const counts = await db
    .select({
      episodeId: shots.episodeId,
      total: dsql<number>`count(*)`,
      approved: dsql<number>`sum(case when ${shots.status} = 'approved' then 1 else 0 end)`,
    })
    .from(shots)
    .groupBy(shots.episodeId);
  const byEp = new Map(counts.map((c) => [c.episodeId, c]));
  return eps.map((e) => ({
    ...e,
    shotsTotal: Number(byEp.get(e.id)?.total ?? 0),
    shotsApproved: Number(byEp.get(e.id)?.approved ?? 0),
  }));
}
