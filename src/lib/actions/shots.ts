"use server";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots, shotEntities, references } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  chainLocation,
  chainTimeWeather,
  composeActionMd,
  normalizeBeats,
  recomputeEpisodeTimecodes,
  sceneChainOf,
} from "@/lib/beats";
import { llmInsertGroups, llmReviseGroup } from "@/lib/llm/factory";
import { buildEntityLinkIndex, linkGroupEntities } from "@/lib/entityLink";
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

    // контекст — ТОЛЬКО соседние группы (не весь сюжет эпизода): что было до и после.
    // Для основной группы вставки соседями не считаются (у них своя мини-история)
    const allRows = await db
      .select()
      .from(shots)
      .where(eq(shots.episodeId, shot.episodeId))
      .orderBy(asc(shots.orderIndex));
    const siblings = shot.isInsert ? allRows : allRows.filter((s) => !s.isInsert);
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

/**
 * Локация сюжетной связки: одна на все группы сцены (до следующего scene_start),
 * поэтому правка на любой группе обновляет ВСЮ связку.
 */
export async function updateGroupLocation(shotId: string, location: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const siblings = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, shot.episodeId))
    .orderBy(asc(shots.orderIndex));
  const chain = sceneChainOf(siblings, shotId);
  const ids = (chain.length ? chain : [shot]).map((s) => s.id);
  await db
    .update(shots)
    .set({ location: location.trim() })
    .where(inArray(shots.id, ids));
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/**
 * Время суток и погода сюжетной связки: одни на все группы сцены (как локация) —
 * правка на любой группе обновляет всю связку.
 */
export async function updateGroupTimeWeather(shotId: string, timeWeather: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const siblings = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, shot.episodeId))
    .orderBy(asc(shots.orderIndex));
  const chain = sceneChainOf(siblings, shotId);
  const ids = (chain.length ? chain : [shot]).map((s) => s.id);
  await db
    .update(shots)
    .set({ timeWeather: timeWeather.trim() })
    .where(inArray(shots.id, ids));
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/**
 * Вставные группы шотов (спин-офф сцены): по запросу пользователя модель создаёт
 * новые группы внутри сцены anchor-шота (шот-начало сцены, где нажат «+»).
 * Вставки получают is_insert=true — свои локация/погода/референсы, своя шкала
 * времени от 00:00; сквозной таймкод эпизода и существующие группы не трогают.
 */
export async function insertShotGroups(
  anchorShotId: string,
  request: string,
  model?: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireAuth();
  if (!request.trim()) return { ok: false, error: "Опишите, что должно быть в новых шотах" };
  try {
    const db = await getDb();
    const [anchor] = await db.select().from(shots).where(eq(shots.id, anchorShotId));
    if (!anchor) return { ok: false, error: "Сцена не найдена" };
    const siblings = await db
      .select()
      .from(shots)
      .where(eq(shots.episodeId, anchor.episodeId))
      .orderBy(asc(shots.orderIndex));

    // контекст для модели: локация/время сцены + краткое содержание её групп
    const chain = sceneChainOf(siblings, anchorShotId);
    const sceneRows = chain.length ? chain : [anchor];
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
    const sceneLocation = chainLocation(siblings, anchorShotId);
    const sceneTimeWeather = chainTimeWeather(siblings, anchorShotId);
    const sceneContext =
      (sceneLocation ? `Локация сцены: ${sceneLocation}\n` : "") +
      (sceneTimeWeather ? `Время и погода сцены: ${sceneTimeWeather}\n` : "") +
      sceneRows.map((s) => `Группа «${s.title}»: ${digest(s)}`).join("\n");

    const res = await llmInsertGroups({
      episodeId: anchor.episodeId,
      sceneContext,
      request,
      model,
    });
    if (!res.groups.length) return { ok: false, error: "Модель не вернула ни одной группы" };

    // точка вставки — конец сцены: перед следующим scene_start основной группы
    // (то есть после последней группы сцены, включая уже существующие вставки)
    const anchorIdx = siblings.findIndex((s) => s.id === anchorShotId);
    let insertPos = siblings.length;
    for (let i = anchorIdx + 1; i < siblings.length; i++) {
      if (siblings[i].sceneStart && !siblings[i].isInsert) {
        insertPos = i;
        break;
      }
    }
    const count = res.groups.length;
    const base =
      insertPos < siblings.length
        ? siblings[insertPos].orderIndex
        : siblings[siblings.length - 1].orderIndex + 1;
    if (insertPos < siblings.length) {
      // раздвигаем хвост эпизода под новые группы
      await db
        .update(shots)
        .set({ orderIndex: sql`${shots.orderIndex} + ${count}` })
        .where(and(eq(shots.episodeId, anchor.episodeId), gte(shots.orderIndex, base)));
    }

    const linkIndex = await buildEntityLinkIndex();
    let order = base;
    for (const group of [...res.groups].sort((a, b) => a.order - b.order)) {
      const shotId = crypto.randomUUID();
      // время шотов нормализуется от 00:00 (вставка = отдельное видео со своей шкалой)
      const { beats, durationSec } = normalizeBeats(group.shots, group.duration_sec);
      await db.insert(shots).values({
        id: shotId,
        episodeId: anchor.episodeId,
        orderIndex: order++,
        title: group.title,
        durationSec,
        beatsJson: JSON.stringify(beats),
        actionMd: composeActionMd(beats, group.title),
        cameraHint: "",
        // свои параметры вставки; модель не задала → стартуем от значений сцены
        location: group.location.trim() || sceneLocation,
        timeWeather: group.time_weather.trim() || sceneTimeWeather,
        status: "draft",
        sceneStart: false,
        isInsert: true,
      });
      await linkGroupEntities(linkIndex, shotId, {
        names: [...group.characters, group.location],
        beatsText: beats
          .map((b) => `${b.framing} ${b.camera} ${b.action} ${b.dialogue}`)
          .join(" "),
        wardrobe: group.wardrobe,
      });
    }
    await recomputeEpisodeTimecodes(anchor.episodeId);
    revalidatePath(`/episodes/${anchor.episodeId}`);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/**
 * Лёгкий read для поллинга вставки групп: клиент сравнивает число групп эпизода
 * с ориентиром — самовосстановление, если ответ долгого экшена потерялся в
 * туннеле (паттерн PromptBlock, см. latestPromptVersion).
 */
export async function countEpisodeShots(episodeId: string): Promise<number> {
  await requireAuth();
  const db = await getDb();
  const rows = await db
    .select({ id: shots.id })
    .from(shots)
    .where(eq(shots.episodeId, episodeId));
  return rows.length;
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
