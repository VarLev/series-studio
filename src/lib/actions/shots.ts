"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots, shotEntities, references } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { composeActionMd, normalizeBeats, recomputeEpisodeTimecodes } from "@/lib/beats";
import { llmReviseGroup } from "@/lib/llm/factory";
import { getSetting } from "@/lib/settings";
import { groupShotSchema, type GroupShot } from "@/lib/llm/contracts";
import { z } from "zod";

function shotPath(episodeId: string, shotId: string) {
  return `/episodes/${episodeId}/shots/${shotId}`;
}

export async function updateShot(
  shotId: string,
  patch: { title?: string; actionMd?: string; cameraHint?: string; durationSec?: number; status?: string },
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  await db.update(shots).set(patch).where(eq(shots.id, shotId));
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

export async function moveShot(shotId: string, direction: "up" | "down"): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const siblings = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, shot.episodeId))
    .orderBy(asc(shots.orderIndex));
  const idx = siblings.findIndex((s) => s.id === shotId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return;
  await db.update(shots).set({ orderIndex: swapWith.orderIndex }).where(eq(shots.id, shot.id));
  await db.update(shots).set({ orderIndex: shot.orderIndex }).where(eq(shots.id, swapWith.id));
  await recomputeEpisodeTimecodes(shot.episodeId); // сквозной отсчёт следует новому порядку
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/** Ручная правка шотов группы: перезаписывает beats_json и собранный из него фрагмент. */
export async function updateGroupBeats(shotId: string, rawBeats: GroupShot[]): Promise<void> {
  await requireAuth();
  const parsed = z.array(groupShotSchema).safeParse(rawBeats);
  if (!parsed.success) return;
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const beats = parsed.data.map((b, i) => ({ ...b, order: i + 1 }));
  await db
    .update(shots)
    .set({ beatsJson: JSON.stringify(beats), actionMd: composeActionMd(beats, shot.title) })
    .where(eq(shots.id, shotId));
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/**
 * Замечание к группе → Claude переписывает её шоты (llmReviseGroup) →
 * группа обновляется, сквозные таймкоды эпизода пересчитываются.
 */
export async function reviseGroup(
  shotId: string,
  feedback: string,
  /** номера шотов группы, к которым ограничить правку (пусто → решает модель) */
  targetOrders: number[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  if (!feedback.trim()) return { ok: false, error: "Напишите замечание" };
  try {
    const db = await getDb();
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (!shot) return { ok: false, error: "Группа не найдена" };
    let currentBeats: GroupShot[] = [];
    try {
      const raw = JSON.parse(shot.beatsJson || "[]");
      if (Array.isArray(raw)) currentBeats = raw as GroupShot[];
    } catch {}

    // контекст — ТОЛЬКО соседние группы (не весь сюжет эпизода): что было до и после
    const siblings = await db
      .select()
      .from(shots)
      .where(eq(shots.episodeId, shot.episodeId))
      .orderBy(asc(shots.orderIndex));
    const idx = siblings.findIndex((s) => s.id === shotId);
    const digest = (s: (typeof siblings)[number]): string => {
      try {
        const b = JSON.parse(s.beatsJson || "[]") as Array<{ action?: string }>;
        if (Array.isArray(b)) {
          const txt = b.map((x) => x.action || "").filter(Boolean).join(" ");
          if (txt) return txt.slice(0, 280);
        }
      } catch {}
      return (s.actionMd || "").slice(0, 280);
    };
    const contextFragment = [
      idx > 0 ? `Перед этой группой («${siblings[idx - 1].title}»): ${digest(siblings[idx - 1])}` : "",
      idx >= 0 && idx < siblings.length - 1
        ? `После этой группы («${siblings[idx + 1].title}»): ${digest(siblings[idx + 1])}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // только валидные номера шотов текущей группы
    const validOrders = new Set(currentBeats.map((b) => b.order));
    const scoped = targetOrders.filter((o) => validOrders.has(o));

    const patch = await llmReviseGroup({
      episodeId: shot.episodeId,
      contextFragment,
      groupTitle: shot.title,
      durationSec: shot.durationSec,
      beats: currentBeats,
      feedback,
      targetOrders: scoped,
      // корректировка шотов — «моделью для простых запросов» из настроек
      model: await getSetting("llm_simple_model"),
    });

    // точечная правка: детерминированно берём из ответа модели ТОЛЬКО целевые шоты,
    // остальные оставляем как были (страховка от того, что модель тронет лишнее)
    let finalShots: GroupShot[];
    let finalTitle: string;
    if (scoped.length) {
      const revisedByOrder = new Map(patch.shots.map((s) => [s.order, s]));
      finalShots = currentBeats.map((orig) =>
        scoped.includes(orig.order) ? (revisedByOrder.get(orig.order) ?? orig) : orig,
      );
      finalTitle = shot.title; // при точечной правке группу не переименовываем
    } else {
      finalShots = patch.shots;
      finalTitle = patch.title || shot.title;
    }

    const { beats, durationSec } = normalizeBeats(
      finalShots,
      scoped.length ? shot.durationSec : patch.duration_sec,
    );
    await db
      .update(shots)
      .set({
        title: finalTitle,
        durationSec,
        beatsJson: JSON.stringify(beats),
        actionMd: composeActionMd(beats, finalTitle),
      })
      .where(eq(shots.id, shotId));
    await recomputeEpisodeTimecodes(shot.episodeId);
    revalidatePath(shotPath(shot.episodeId, shotId));
    revalidatePath(`/episodes/${shot.episodeId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Начало новой сюжетной сцены: связности с предыдущей группой нет (кроме библии). */
export async function setSceneStart(shotId: string, value: boolean): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  await db.update(shots).set({ sceneStart: value }).where(eq(shots.id, shotId));
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/**
 * Якорь одежды. `outfit` — сценарный наряд (EN); `source` — что уходит в промпт:
 * "bible" (базовый гардероб из библии) или "generated" (сценарный наряд).
 */
export async function setShotEntityOutfit(
  shotId: string,
  entityId: string,
  outfit: string,
  source: "bible" | "generated" = "generated",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db
    .update(shotEntities)
    .set({ outfit: outfit.trim(), outfitSource: source })
    .where(and(eq(shotEntities.shotId, shotId), eq(shotEntities.entityId, entityId)));
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, shotId));
}

export async function addShotEntity(shotId: string, entityId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db
    .insert(shotEntities)
    .values({ shotId, entityId, auto: false })
    .onConflictDoNothing();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, shotId));
}

export async function removeShotEntity(shotId: string, entityId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db
    .delete(shotEntities)
    .where(and(eq(shotEntities.shotId, shotId), eq(shotEntities.entityId, entityId)));
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, shotId));
}

/** Прикрепить референс (серии или библии) к шоту (роль: start_frame | composition). */
export async function attachReferenceToShot(
  shotId: string,
  referenceId: string,
  role: "start_frame" | "composition",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
  if (!ref) return;
  if (role === "start_frame") {
    // start-frame один на шот — прежний становится композицией (spec §3.6)
    await db.update(references).set({ role: "composition" }).where(eq(references.shotId, shotId));
  }
  await db.insert(references).values({
    id: crypto.randomUUID(),
    shotId,
    entityId: ref.entityId,
    storagePath: ref.storagePath,
    caption: ref.caption || ref.token || "",
    source: ref.source,
    role,
    width: ref.width,
    height: ref.height,
  });
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, shotId));
}

export async function detachShotReference(referenceId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
  if (!ref?.shotId) return;
  await db.delete(references).where(eq(references.id, referenceId));
  // файл общий с референсом-оригиналом (attach копирует строку) — удаляем, только
  // если больше никто не ссылается; кэш медиа провайдера сбрасываем всегда
  const { maybeDeleteBlob, invalidateProviderCaches } = await import("@/lib/cascade");
  await maybeDeleteBlob(ref.storagePath);
  await invalidateProviderCaches({ refIds: [referenceId] });
  const [shot] = await db.select().from(shots).where(eq(shots.id, ref.shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, ref.shotId));
}

export async function setShotReferenceRole(
  referenceId: string,
  role: "start_frame" | "composition",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
  if (!ref?.shotId) return;
  if (role === "start_frame") {
    // start-frame один на шот (spec §3.6)
    await db.update(references).set({ role: "composition" }).where(eq(references.shotId, ref.shotId));
  }
  await db.update(references).set({ role }).where(eq(references.id, referenceId));
  const [shot] = await db.select().from(shots).where(eq(shots.id, ref.shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, ref.shotId));
}
