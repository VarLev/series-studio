import { and, asc, eq } from "drizzle-orm";
import { getDb, anchors, shotAnchors } from "@/lib/db";

/**
 * Якоря — короткие текстовые детали-инъекции группы шотов (синяк на лице, цвет
 * одежды, предмет в кадре). Живут за ЭПИЗОДОМ (пул) и цепляются к N группам через
 * shot_anchors. Прикреплённые к группе якоря — ОБЯЗАТЕЛЬНЫЕ пометки в видео-промпте,
 * Enhance и Rework. Модуль — чистые DB-хелперы (без "use server"): их зовут и
 * серверные страницы, и промпт-фабрика, и экшены.
 */

export interface AnchorRow {
  id: string;
  text: string;
  source: string; // manual | enhance
}

/** Якоря, прикреплённые к группе (в порядке создания — стабильный порядок чипов). */
export async function listShotAnchors(shotId: string): Promise<AnchorRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: anchors.id, text: anchors.text, source: anchors.source })
    .from(shotAnchors)
    .innerJoin(anchors, eq(shotAnchors.anchorId, anchors.id))
    .where(eq(shotAnchors.shotId, shotId))
    .orderBy(asc(anchors.createdAt));
  return rows;
}

/** Только тексты прикреплённых якорей — для промпт-фабрики (Enhance/Rework/промпт). */
export async function getShotAnchorTexts(shotId: string): Promise<string[]> {
  return (await listShotAnchors(shotId)).map((a) => a.text);
}

/** Весь пул якорей эпизода — для панели переиспользования. */
export async function listEpisodeAnchors(episodeId: string): Promise<AnchorRow[]> {
  const db = await getDb();
  return db
    .select({ id: anchors.id, text: anchors.text, source: anchors.source })
    .from(anchors)
    .where(eq(anchors.episodeId, episodeId))
    .orderBy(asc(anchors.createdAt));
}

/**
 * Создать якорь в пуле эпизода и (по умолчанию) прикрепить к группе. Возвращает id.
 * Пустой текст игнорируется (возвращает null). Дедуп по тексту в рамках эпизода:
 * повтор не плодит копию, а переиспользует существующий якорь.
 */
export async function createEpisodeAnchor(
  episodeId: string,
  shotId: string | null,
  text: string,
  source: "manual" | "enhance" = "manual",
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const db = await getDb();
  // дедуп: тот же текст в этом эпизоде — переиспользуем, не создаём дубликат
  const existing = (await listEpisodeAnchors(episodeId)).find(
    (a) => a.text.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const id = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await db.insert(anchors).values({ id, episodeId, text: trimmed, source });
  }
  if (shotId) {
    await db.insert(shotAnchors).values({ shotId, anchorId: id }).onConflictDoNothing();
  }
  return id;
}

/** Прикрепить существующий якорь эпизода к группе (идемпотентно). */
export async function attachAnchorToShot(shotId: string, anchorId: string): Promise<void> {
  const db = await getDb();
  await db.insert(shotAnchors).values({ shotId, anchorId }).onConflictDoNothing();
}

/** Открепить якорь от группы (сам якорь остаётся в пуле эпизода для переиспользования). */
export async function detachAnchorFromShot(shotId: string, anchorId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(shotAnchors)
    .where(and(eq(shotAnchors.shotId, shotId), eq(shotAnchors.anchorId, anchorId)));
}

/** Удалить якорь из эпизода целиком — вместе со всеми привязками к группам. */
export async function deleteEpisodeAnchor(anchorId: string): Promise<void> {
  const db = await getDb();
  await db.delete(shotAnchors).where(eq(shotAnchors.anchorId, anchorId));
  await db.delete(anchors).where(eq(anchors.id, anchorId));
}
