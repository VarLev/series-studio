"use server";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots, shotEntities, references, entities } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  chainLocation,
  chainTimeWeather,
  composeActionMd,
  normalizeBeats,
  recomputeEpisodeTimecodes,
  sceneChainOf,
} from "@/lib/beats";
import { llmEnhanceGroup, llmInsertGroups, llmReviseGroup } from "@/lib/llm/factory";
import { createEpisodeAnchor, getShotAnchorTexts } from "@/lib/anchors";
import { ensureShotRefsAnalyzed } from "@/lib/refs";
import { reconcileShotPromptRefs } from "@/lib/refDirectives";
import { buildEntityLinkIndex, linkGroupEntities } from "@/lib/entityLink";
import { listTechniques } from "@/lib/director";
import { stripAt } from "@/lib/entityName";
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

/**
 * Ручная правка шотов группы: перезаписывает beats_json и собранный из него
 * фрагмент. Нормализация — единой normalizeBeats: основные шоты (Main) получают
 * order 1..N, тайминг от 00:00 и дают durationSec группы; черновые (Draft) —
 * свою шкалу и order после основных, в длительность не входят. Дальше
 * recomputeEpisodeTimecodes обновляет сквозные таймкоды эпизода.
 */
export async function updateGroupBeats(shotId: string, rawBeats: GroupShot[]): Promise<void> {
  await requireAuth();
  const parsed = z.array(groupShotSchema).safeParse(rawBeats);
  if (!parsed.success) {
    // раньше молча возвращались — клиент показывал «Шоты сохранены», хотя запись
    // не шла, и после обновления страницы правка откатывалась. Теперь честно падаем,
    // чтобы клиент показал ошибку, а не ложный успех.
    console.error("[updateGroupBeats] невалидные шоты:", parsed.error.issues);
    throw new Error("Не удалось сохранить шоты: некорректные данные");
  }
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const { beats, durationSec } = normalizeBeats(parsed.data, shot.durationSec);
  await db
    .update(shots)
    .set({
      beatsJson: JSON.stringify(beats),
      actionMd: composeActionMd(beats, shot.title),
      durationSec,
    })
    .where(eq(shots.id, shotId));
  await recomputeEpisodeTimecodes(shot.episodeId);
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/**
 * Замечание к группе → Claude переписывает её шоты (llmReviseGroup) →
 * группа обновляется, сквозные таймкоды эпизода пересчитываются.
 */
type RevResult = { ok: true } | { ok: false; error: string };
type GlobalRevlock = typeof globalThis & { __ssReviseInflight?: Map<string, Promise<RevResult>> };

export async function reviseGroup(
  shotId: string,
  feedback: string,
  /** номера шотов группы, к которым ограничить правку (пусто → решает модель) */
  targetOrders: number[] = [],
): Promise<RevResult> {
  await requireAuth();
  if (!feedback.trim()) return { ok: false, error: "Напишите замечание" };
  // Дедуп: долгий CLI-вызов через туннель браузер/Next повторяют, пока первый жив —
  // это плодило ВТОРОЙ Sonnet-процесс на ~200с и ложную ошибку «нет ответа 4 минуты»
  // в UI. Повтор с ТЕМ ЖЕ замечанием теперь ждёт результат уже идущего вызова, а не
  // запускает новый. Ключ включает feedback: другое замечание — легитимно новый вызов.
  const g = globalThis as GlobalRevlock;
  if (!g.__ssReviseInflight) g.__ssReviseInflight = new Map();
  const key = `${shotId}::${targetOrders.join(",")}::${feedback}`;
  const inflight = g.__ssReviseInflight.get(key);
  if (inflight) return inflight;
  const work = doReviseGroup(shotId, feedback, targetOrders).finally(() => {
    g.__ssReviseInflight!.delete(key);
  });
  g.__ssReviseInflight.set(key, work);
  return work;
}

async function doReviseGroup(
  shotId: string,
  feedback: string,
  targetOrders: number[] = [],
): Promise<RevResult> {
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
        const b = JSON.parse(s.beatsJson || "[]") as Array<{ action?: string; draft?: boolean }>;
        if (Array.isArray(b)) {
          // черновые шоты — не сюжетная канва: в дайджест соседей не попадают
          const txt = b.filter((x) => !x.draft).map((x) => x.action || "").filter(Boolean).join(" ");
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

    // реворк оперирует ТОЛЬКО основными шотами: черновики (Draft Shots) проходят
    // насквозь нетронутыми — иначе ответ модели (groupShotSchema, draft default
    // false) молча превратил бы их в основные
    const mainCurrent = currentBeats.filter((b) => !b.draft);
    const draftCurrent = currentBeats.filter((b) => b.draft);

    // только валидные номера ОСНОВНЫХ шотов текущей группы
    const validOrders = new Set(mainCurrent.map((b) => b.order));
    const scoped = targetOrders.filter((o) => validOrders.has(o));

    // догоняем анализ референсов группы, чтобы реворк учитывал их контекст
    await ensureShotRefsAnalyzed(shotId);
    // модель и канал заданы в llmReviseGroup: всегда Claude через CLI (подписка)
    const patch = await llmReviseGroup({
      episodeId: shot.episodeId,
      shotId,
      contextFragment,
      groupTitle: shot.title,
      durationSec: shot.durationSec,
      beats: mainCurrent,
      feedback,
      targetOrders: scoped,
      // прикреплённые якоря — обязательные детали, которые правка не должна терять
      anchors: await getShotAnchorTexts(shotId),
    });

    // точечная правка: детерминированно берём из ответа модели ТОЛЬКО целевые шоты,
    // остальные оставляем как были (страховка от того, что модель тронет лишнее)
    let finalShots: GroupShot[];
    let finalTitle: string;
    if (scoped.length) {
      const revisedByOrder = new Map(patch.shots.map((s) => [s.order, s]));
      finalShots = mainCurrent.map((orig) =>
        scoped.includes(orig.order) ? (revisedByOrder.get(orig.order) ?? orig) : orig,
      );
      finalTitle = shot.title; // при точечной правке группу не переименовываем
    } else {
      finalShots = patch.shots;
      finalTitle = patch.title || shot.title;
    }

    const { beats, durationSec } = normalizeBeats(
      // ответ модели — основные (draft сбрасываем на false на всякий случай),
      // черновики группы возвращаются как были
      [...finalShots.map((s) => ({ ...s, draft: false })), ...draftCurrent],
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
 * Enhance (кнопка на группе): Opus через CLI переоценивает группу целиком и
 * УЛУЧШАЕТ существующие основные шоты (Main), НЕ пересобирая сюжет: шлифует планы/
 * камеру, дозаполняет поля, при нехватке времени разбивает шот, закрепляет приёмы,
 * уточняет локацию/погоду/тон и синхронизирует персонажей в кадре. Черновики (Draft)
 * не читаются и не трогаются — сохраняются как есть.
 * ВСЕГДА Opus + CLI (подписка) — это задано в llmEnhanceGroup, не настройкой.
 */
export async function enhanceGroup(
  shotId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const db = await getDb();
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (!shot) return { ok: false, error: "Группа не найдена" };
    let currentBeats: GroupShot[] = [];
    try {
      const raw = JSON.parse(shot.beatsJson || "[]");
      if (Array.isArray(raw)) currentBeats = raw as GroupShot[];
    } catch {}
    // Enhance работает ТОЛЬКО с основными шотами (Main): улучшает существующее, не
    // пересобирает. Черновики (Draft) полностью игнорируются и сохраняются как есть.
    const mainCurrent = currentBeats.filter((b) => !b.draft);
    const draftCurrent = currentBeats.filter((b) => b.draft);

    const allRows = await db
      .select()
      .from(shots)
      .where(eq(shots.episodeId, shot.episodeId))
      .orderBy(asc(shots.orderIndex));
    const siblings = shot.isInsert ? allRows : allRows.filter((s) => !s.isInsert);
    const idx = siblings.findIndex((s) => s.id === shotId);
    const digest = (s: (typeof siblings)[number]): string => {
      try {
        const b = JSON.parse(s.beatsJson || "[]") as Array<{ action?: string; draft?: boolean }>;
        if (Array.isArray(b)) {
          // черновые шоты — не сюжетная канва: в дайджест соседей не попадают
          const txt = b.filter((x) => !x.draft).map((x) => x.action || "").filter(Boolean).join(" ");
          if (txt) return txt.slice(0, 280);
        }
      } catch {}
      return (s.actionMd || "").slice(0, 280);
    };
    const sceneContext = [
      idx > 0 ? `Перед этой группой («${siblings[idx - 1].title}»): ${digest(siblings[idx - 1])}` : "",
      idx >= 0 && idx < siblings.length - 1
        ? `После этой группы («${siblings[idx + 1].title}»): ${digest(siblings[idx + 1])}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // догоняем анализ референсов группы, чтобы Enhance учитывал их контекст
    await ensureShotRefsAnalyzed(shotId);
    // якоря группы: если их НЕТ — Enhance может предложить новые; если ЕСТЬ — только
    // учитывает существующие и новых не выдумывает (решает по наличию, не пользователь)
    const existingAnchors = await getShotAnchorTexts(shotId);
    const res = await llmEnhanceGroup({
      episodeId: shot.episodeId,
      shotId,
      groupTitle: shot.title,
      durationSec: shot.durationSec,
      beats: mainCurrent,
      location: chainLocation(allRows, shotId),
      timeWeather: chainTimeWeather(allRows, shotId),
      emotionalTone: shot.emotionalTone,
      sceneContext,
      anchors: existingAnchors,
    });
    // Enhance только улучшает Main: все возвращённые шоты — основные (draft:false),
    // shots_draft игнорируем полностью (черновиков Enhance не создаёт)
    const improvedMain: GroupShot[] = res.shots.map((s) => ({ ...s, draft: false }));
    if (!improvedMain.length) {
      return { ok: false, error: "Модель не вернула ни одного основного шота" };
    }

    // приёмы: оставляем только реально существующие в библиотеке id, максимум 1 на шот
    const knownTech = new Set((await listTechniques()).map((t) => t.id));
    const cleanMain = improvedMain.map((s) => ({
      ...s,
      technique_id: s.technique_id && knownTech.has(s.technique_id) ? s.technique_id : "",
    }));
    // объединяем улучшенные основные с НЕТРОНУТЫМИ черновиками пользователя
    const cleanShots = [...cleanMain, ...draftCurrent];

    const { beats, durationSec } = normalizeBeats(cleanShots, res.duration_sec);
    const finalTitle = res.title.trim() || shot.title;
    await db
      .update(shots)
      .set({
        title: finalTitle,
        durationSec,
        beatsJson: JSON.stringify(beats),
        actionMd: composeActionMd(beats, finalTitle),
        // тон — свой у группы; локацию/погоду обновим по всей связке ниже
        emotionalTone: res.emotional_tone.trim() || shot.emotionalTone,
      })
      .where(eq(shots.id, shotId));

    // локация/погода — единые на связку (как updateGroupLocation): пишем всей сцене
    if (res.location.trim() || res.time_weather.trim()) {
      const chain = sceneChainOf(allRows, shotId);
      const chainIds = (chain.length ? chain : [shot]).map((s) => s.id);
      const patch: { location?: string; timeWeather?: string } = {};
      if (res.location.trim()) patch.location = res.location.trim();
      if (res.time_weather.trim()) patch.timeWeather = res.time_weather.trim();
      await db.update(shots).set(patch).where(inArray(shots.id, chainIds));
    }

    // умная синхронизация персонажей в кадре: привязать реально видимых, убрать
    // авто-привязанных персонажей, которых в кадре нет (стили и ручные — не трогаем)
    await syncFrameCharacters(shotId, res.characters_in_frame);

    // локация из библии: если итоговая локация/текст шотов совпали с location-
    // сущностью — привязываем её (референс окружения уйдёт в промпт и задачу);
    // авто-привязки локаций, которые больше не совпадают, снимаем (ручные — нет)
    await syncLocationEntities(
      shotId,
      res.location.trim() || shot.location,
      cleanMain.map((s) => `${s.framing} ${s.camera} ${s.action}`).join(" "),
    );

    // якоря: Enhance предлагает новые ТОЛЬКО когда своих ещё не было — создаём их в
    // пуле эпизода и цепляем к группе (source=enhance). Если якоря уже были, res.anchors
    // приходит пустым (так велит промпт) и мы ничего не трогаем.
    if (!existingAnchors.length && res.anchors.length) {
      for (const text of res.anchors) {
        await createEpisodeAnchor(shot.episodeId, shotId, text, "enhance");
      }
    }

    await recomputeEpisodeTimecodes(shot.episodeId);
    revalidatePath(shotPath(shot.episodeId, shotId));
    revalidatePath(`/episodes/${shot.episodeId}`);
    return { ok: true };
  } catch (e) {
    // стек в терминал сервера: тост клиента может не дожить до пользователя
    // (туннель), а «Failed query…» без стека дважды уводил отладку не туда
    console.error("[enhanceGroup]", e);
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/**
 * Синхронизация «кто в кадре» для группы: element_name'ы из Enhance → привязки
 * shotEntities. Добавляем видимых персонажей (auto), снимаем авто-привязки
 * персонажей, которых модель не считает в кадре. НЕ трогаем стили (type=style)
 * и ручные привязки (auto=false) — их пользователь ставил сам.
 */
async function syncFrameCharacters(shotId: string, elementNames: string[]): Promise<void> {
  const db = await getDb();
  const index = await buildEntityLinkIndex();
  const wanted = new Set(
    elementNames
      .map((n) => index.byName.get(stripAt(n)))
      .filter((id): id is string => Boolean(id)),
  );

  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const linkedEntities = links.length
    ? await db.select().from(entities).where(inArray(entities.id, links.map((l) => l.entityId)))
    : [];
  const typeById = new Map(linkedEntities.map((e) => [e.id, e.type]));

  // снять авто-привязки ПЕРСОНАЖЕЙ, которых нет в кадре (стили/ручные не трогаем)
  for (const l of links) {
    if (l.auto && typeById.get(l.entityId) === "character" && !wanted.has(l.entityId)) {
      await db
        .delete(shotEntities)
        .where(and(eq(shotEntities.shotId, shotId), eq(shotEntities.entityId, l.entityId)));
    }
  }
  // привязать видимых (идемпотентно)
  for (const entityId of wanted) {
    await db.insert(shotEntities).values({ shotId, entityId, auto: true }).onConflictDoNothing();
  }
}

/**
 * Синхронизация локации из библии для группы: если имя/element_name location-
 * сущности встречается в тексте локации или шотов — привязываем её (auto);
 * авто-привязки локаций, которые больше не совпадают, снимаем. Ручные привязки
 * (auto=false) и сущности других типов не трогаем. Матчинг по границам слов —
 * та же логика, что в entityLink.ts.
 */
async function syncLocationEntities(
  shotId: string,
  locationText: string,
  beatsText: string,
): Promise<void> {
  const db = await getDb();
  const locs = await db
    .select()
    .from(entities)
    .where(and(eq(entities.type, "location"), eq(entities.archived, false)));
  if (!locs.length) return;
  const hay = `${locationText} ${beatsText}`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hit = (key: string) =>
    key.length >= 2 && new RegExp(`(^|[^\\wа-яё])${esc(key)}([^\\wа-яё]|$)`, "i").test(hay);
  const wanted = new Set(
    locs.filter((l) => hit(stripAt(l.elementName)) || hit(stripAt(l.name))).map((l) => l.id),
  );
  const locIds = new Set(locs.map((l) => l.id));
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  for (const l of links) {
    if (l.auto && locIds.has(l.entityId) && !wanted.has(l.entityId)) {
      await db
        .delete(shotEntities)
        .where(and(eq(shotEntities.shotId, shotId), eq(shotEntities.entityId, l.entityId)));
    }
  }
  for (const entityId of wanted) {
    await db.insert(shotEntities).values({ shotId, entityId, auto: true }).onConflictDoNothing();
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
 * Эмоциональный тон группы: в отличие от локации/погоды — СВОЙ у каждой группы,
 * поэтому правка обновляет ТОЛЬКО эту группу (не сюжетную связку). Задаёт
 * настроение/атмосферу группы в промпте, перекрывая общий тон сериала.
 */
export async function updateGroupEmotionalTone(shotId: string, emotionalTone: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  await db
    .update(shots)
    .set({ emotionalTone: emotionalTone.trim() })
    .where(eq(shots.id, shotId));
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
        const b = JSON.parse(s.beatsJson || "[]") as Array<{ action?: string; draft?: boolean }>;
        if (Array.isArray(b)) {
          // черновые шоты — не сюжетная канва: в дайджест соседей не попадают
          const txt = b.filter((x) => !x.draft).map((x) => x.action || "").filter(Boolean).join(" ");
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
        emotionalTone: group.emotional_tone.trim(),
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
 * Лёгкий read для поллинга Enhance: «отпечаток» группы (шоты как строка).
 * Клиент сравнивает с ориентиром до запуска — самовосстановление, если ответ
 * долгого экшена (Opus 60–120с) потерялся в туннеле (паттерн PromptBlock).
 */
export async function groupBeatsStamp(shotId: string): Promise<string> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select({ beatsJson: shots.beatsJson })
    .from(shots)
    .where(eq(shots.id, shotId));
  return row?.beatsJson ?? "";
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
  role: "start_frame" | "composition" | "layout",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
  if (!ref) return;
  if (role === "start_frame") {
    // start-frame один на шот — прежний становится композицией (spec §3.6);
    // composition/layout-референсы не трогаем
    await db
      .update(references)
      .set({ role: "composition" })
      .where(and(eq(references.shotId, shotId), eq(references.role, "start_frame")));
  }
  const copyId = crypto.randomUUID();
  await db.insert(references).values({
    id: copyId,
    shotId,
    entityId: ref.entityId,
    storagePath: ref.storagePath,
    caption: ref.caption || ref.token || "",
    // копируем готовый анализ оригинала (реаттач не перезапускает vision-модель)
    analysis: ref.analysis ?? "",
    source: ref.source,
    role,
    width: ref.width,
    height: ref.height,
  });
  // если у оригинала анализа ещё не было — разберём картинку ФОНОМ. Ожидание
  // vision-вызова здесь держало server action до минуты (ретраи Gemini), и
  // миниатюра появлялась только после него без всякого отклика. Слайдер деталей
  // и Enhance/Rework дозапросят анализ сами (ensureShotRefsAnalyzed).
  const { ensureReferenceAnalysis } = await import("@/lib/refs");
  void ensureReferenceAnalysis(copyId).catch(() => {});
  // авто-синхронизация начальных строк-директив референса в актуальных промптах —
  // без обращения к модели (добавили референс → строки появились сами)
  await reconcileShotPromptRefs(shotId);
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, shotId));
}

/**
 * Ручной/фоновый запрос анализа референса (слайдер деталей референса): если анализ
 * ещё пуст — запускает vision-модель (или берёт кэш по файлу) и возвращает текст.
 */
export async function analyzeShotReference(
  referenceId: string,
): Promise<{ ok: true; analysis: string } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const { ensureReferenceAnalysis } = await import("@/lib/refs");
    await ensureReferenceAnalysis(referenceId);
    const db = await getDb();
    const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
    const [shot] = ref?.shotId
      ? await db.select().from(shots).where(eq(shots.id, ref.shotId))
      : [];
    if (shot) revalidatePath(shotPath(shot.episodeId, shot.id));
    return { ok: true, analysis: ref?.analysis ?? "" };
  } catch (err) {
    console.error("analyzeShotReference failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  // удалили референс → его строки-директивы уходят из промптов сами (без модели)
  await reconcileShotPromptRefs(ref.shotId);
  const [shot] = await db.select().from(shots).where(eq(shots.id, ref.shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, ref.shotId));
}

export async function setShotReferenceRole(
  referenceId: string,
  role: "start_frame" | "composition" | "layout",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, referenceId));
  if (!ref?.shotId) return;
  if (role === "start_frame") {
    // start-frame один на шот (spec §3.6): демотим ТОЛЬКО прежний start-frame,
    // не трогая composition/layout-референсы шота
    await db
      .update(references)
      .set({ role: "composition" })
      .where(and(eq(references.shotId, ref.shotId), eq(references.role, "start_frame")));
  }
  await db.update(references).set({ role }).where(eq(references.id, referenceId));
  // сменили тип референса → начальные строки промптов перестраиваются сами (без модели)
  await reconcileShotPromptRefs(ref.shotId);
  const [shot] = await db.select().from(shots).where(eq(shots.id, ref.shotId));
  if (shot) revalidatePath(shotPath(shot.episodeId, ref.shotId));
}
