import { eq } from "drizzle-orm";
import { getDb, shots, shotEntities, shotAnchors, type DB } from "@/lib/db";

/**
 * Снимок «первоначального состояния» группы шотов — то содержимое, которое
 * воссоздаёт раскадровка. По нему работает кнопка Revert (см. revertGroup).
 *
 * Что входит: заголовок, тайминг и сами шоты (beatsJson/actionMd), подсказка
 * камеры, эмоциональный тон, флаг сцены, красные чипы-заготовки (unlinkedChars),
 * персонажи в кадре (shot_entities с нарядами) и привязанные якоря.
 *
 * location/timeWeather тоже входят: revertGroup возвращает их по всей сюжетной
 * связке (как updateGroupLocation/Enhance), чтобы не рассинхронить сцену.
 */
export type GroupOriginSnapshot = {
  v: 1;
  title: string;
  durationSec: number;
  beatsJson: string;
  actionMd: string;
  cameraHint: string;
  emotionalTone: string;
  sceneStart: boolean;
  unlinkedCharsJson: string;
  location: string;
  timeWeather: string;
  isInsert: boolean;
  // сквозное состояние (дифы state_begin/state_end) — часть содержимого
  // раскадровки. Опциональны: снимки, зафиксированные до фичи, их не имеют —
  // Revert тогда состояние не трогает
  stateBeginJson?: string;
  stateEndJson?: string;
  entities: { entityId: string; auto: boolean; outfit: string; outfitSource: string }[];
  anchorIds: string[];
};

type ShotRow = typeof shots.$inferSelect;

/** Собрать снимок из ТЕКУЩЕГО состояния группы (shots + shot_entities + shot_anchors). */
export async function buildGroupSnapshot(db: DB, shot: ShotRow): Promise<GroupOriginSnapshot> {
  const ents = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shot.id));
  const anchs = await db.select().from(shotAnchors).where(eq(shotAnchors.shotId, shot.id));
  return {
    v: 1,
    title: shot.title,
    durationSec: shot.durationSec,
    beatsJson: shot.beatsJson,
    actionMd: shot.actionMd,
    cameraHint: shot.cameraHint,
    emotionalTone: shot.emotionalTone,
    sceneStart: shot.sceneStart,
    unlinkedCharsJson: shot.unlinkedCharsJson,
    location: shot.location,
    timeWeather: shot.timeWeather,
    isInsert: shot.isInsert,
    stateBeginJson: shot.stateBeginJson,
    stateEndJson: shot.stateEndJson,
    entities: ents.map((e) => ({
      entityId: e.entityId,
      auto: e.auto,
      outfit: e.outfit,
      outfitSource: e.outfitSource,
    })),
    anchorIds: anchs.map((a) => a.anchorId),
  };
}

/**
 * Идемпотентно зафиксировать снимок группы, если он ещё не зафиксирован.
 * - новые группы (разбивка/вставка) → снимок = свежесозданное состояние;
 * - существующие группы → снимок = текущее состояние при первом открытии
 *   (исходник «как при раскадровке» им взять неоткуда — он не сохранялся).
 * Повторные вызовы — no-op (только SELECT): точка отката фиксируется один раз.
 */
export async function ensureGroupOrigin(shotId: string): Promise<void> {
  try {
    const db = await getDb();
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (!shot) return;
    if (shot.originJson && shot.originJson.trim()) return;
    const snap = await buildGroupSnapshot(db, shot);
    await db.update(shots).set({ originJson: JSON.stringify(snap) }).where(eq(shots.id, shotId));
  } catch (e) {
    // фиксация снимка — вторична: её сбой не должен ронять создание группы,
    // Enhance/Rework или загрузку страницы. Revert для этой группы просто будет
    // недоступен, пока снимок не зафиксируется при следующем открытии.
    console.error("[ensureGroupOrigin]", e);
  }
}
