"use server";

import { asc, desc, eq, sql as dsql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, episodes, shots, shotEntities, entities, prompts } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { llmSynopsis, llmBreakdown } from "@/lib/llm/factory";
import type { Breakdown } from "@/lib/llm/contracts";

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

export async function generateSynopsis(
  episodeId: string,
  brief: string,
): Promise<{ ok: true; synopsis: string } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const synopsis = await llmSynopsis(episodeId, brief);
    const db = await getDb();
    await db.update(episodes).set({ synopsisMd: synopsis }).where(eq(episodes.id, episodeId));
    revalidatePath(`/episodes/${episodeId}`);
    return { ok: true, synopsis };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

export async function breakdownEpisode(
  episodeId: string,
): Promise<{ ok: true; breakdown: Breakdown } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const db = await getDb();
    const [ep] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!ep) return { ok: false, error: "Эпизод не найден" };
    if (!ep.synopsisMd.trim()) return { ok: false, error: "Сначала напишите или сгенерируйте сюжет" };
    const breakdown = await llmBreakdown(episodeId, ep.synopsisMd);
    return { ok: true, breakdown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Пользователь подтвердил предпросмотр раскадровки → создаём карточки групп. */
export async function saveBreakdown(episodeId: string, breakdown: Breakdown): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const allEntities = await db.select().from(entities);
  const byElement = new Map(allEntities.map((e) => [e.elementName.toLowerCase(), e.id]));

  // Replace existing storyboard: delete previous shots of this episode
  const oldShots = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  for (const s of oldShots) {
    await db.delete(shotEntities).where(eq(shotEntities.shotId, s.id));
    await db.delete(prompts).where(eq(prompts.shotId, s.id));
  }
  await db.delete(shots).where(eq(shots.episodeId, episodeId));

  let index = 1;
  for (const item of [...breakdown.shots].sort((a, b) => a.order - b.order)) {
    const shotId = crypto.randomUUID();
    await db.insert(shots).values({
      id: shotId,
      episodeId,
      orderIndex: index++,
      title: item.title,
      durationSec: Math.min(15, Math.max(3, item.duration_sec)),
      actionMd: item.action,
      cameraHint: item.camera_hint,
      status: "draft",
    });
    for (const el of item.entities) {
      const entityId = byElement.get(el.toLowerCase());
      if (entityId) {
        await db
          .insert(shotEntities)
          .values({ shotId, entityId, auto: true })
          .onConflictDoNothing();
      }
    }
  }
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
