"use server";

import { asc, desc, eq, sql as dsql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, episodes, shots, shotEntities, entities, prompts } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { llmBreakdown } from "@/lib/llm/factory";
import { setSetting } from "@/lib/settings";
import { composeActionMd, normalizeBeats, recomputeEpisodeTimecodes } from "@/lib/beats";
import { stripAt } from "@/lib/entityName";
import type { Breakdown } from "@/lib/llm/contracts";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function createEpisode(): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [last] = await db.select().from(episodes).orderBy(desc(episodes.number)).limit(1);
  const id = crypto.randomUUID();
  await db.insert(episodes).values({ id, number: (last?.number ?? 0) + 1 });
  redirect(`/episodes/${id}`);
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
  // без учёта @ и регистра (element_name всегда с @, модель может писать и без)
  const allEntities = await db.select().from(entities);
  const byName = new Map<string, string>();
  for (const e of allEntities) {
    byName.set(stripAt(e.elementName), e.id);
    byName.set(stripAt(e.name), e.id);
  }
  // индекс для скана текста битов: регэксп по границам слов → id сущности
  const scanIndex = allEntities
    .flatMap((e) => [
      { key: stripAt(e.name), id: e.id },
      { key: stripAt(e.elementName), id: e.id },
    ])
    .filter((x) => x.key.length >= 2)
    .map((x) => ({ id: x.id, re: new RegExp(`(^|[^\\wа-яё])${escapeRe(x.key)}([^\\wа-яё]|$)`, "i") }));

  const oldShots = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  if (mode === "replace") {
    for (const s of oldShots) {
      await db.delete(shotEntities).where(eq(shotEntities.shotId, s.id));
      await db.delete(prompts).where(eq(prompts.shotId, s.id));
    }
    await db.delete(shots).where(eq(shots.episodeId, episodeId));
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
      status: "draft",
    });
    const linked = new Set<string>();
    // 1) явный список персонажей/локаций группы от модели
    for (const name of [...group.characters, group.location]) {
      const entityId = byName.get(stripAt(name));
      if (entityId) linked.add(entityId);
    }
    // 2) скан текста битов: подхватываем упомянутых в кадре персонажей из библии,
    //    которых модель забыла внести в characters[] (замечание заказчика: Craig в тени)
    const beatsText = beats
      .map((b) => `${b.framing} ${b.camera} ${b.action} ${b.dialogue}`)
      .join(" ");
    for (const { id, re } of scanIndex) {
      if (re.test(beatsText)) linked.add(id);
    }
    for (const entityId of linked) {
      await db
        .insert(shotEntities)
        .values({ shotId, entityId, auto: true })
        .onConflictDoNothing();
    }
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
