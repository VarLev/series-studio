"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots, anchors } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  attachAnchorToShot,
  createEpisodeAnchor,
  deleteEpisodeAnchor,
  detachAnchorFromShot,
} from "@/lib/anchors";

/**
 * Якоря группы (server-actions). Создание/прикрепление/открепление живут за
 * эпизодом; открепление НЕ удаляет якорь из пула (переиспользование), полное
 * удаление — deleteAnchor. Ревалидируем страницу группы и список эпизода.
 */

function shotPath(episodeId: string, shotId: string) {
  return `/episodes/${episodeId}/shots/${shotId}`;
}

async function revalidateForShot(shotId: string): Promise<void> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/** Создать якорь в эпизоде группы и прикрепить к ней. */
export async function createAnchor(shotId: string, text: string): Promise<void> {
  await requireAuth();
  if (!text.trim()) return;
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  await createEpisodeAnchor(shot.episodeId, shotId, text, "manual");
  revalidatePath(shotPath(shot.episodeId, shotId));
  revalidatePath(`/episodes/${shot.episodeId}`);
}

/** Прикрепить существующий якорь эпизода к группе (переиспользование). */
export async function attachAnchor(shotId: string, anchorId: string): Promise<void> {
  await requireAuth();
  await attachAnchorToShot(shotId, anchorId);
  await revalidateForShot(shotId);
}

/** Открепить якорь от группы (остаётся в пуле эпизода). */
export async function detachAnchor(shotId: string, anchorId: string): Promise<void> {
  await requireAuth();
  await detachAnchorFromShot(shotId, anchorId);
  await revalidateForShot(shotId);
}

/**
 * Удалить якорь из эпизода целиком. Ревалидируем текущую группу (вызывается с её
 * страницы) и весь эпизод — якорь мог висеть на нескольких группах.
 */
export async function deleteAnchor(shotId: string, anchorId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [anchor] = await db.select().from(anchors).where(eq(anchors.id, anchorId));
  await deleteEpisodeAnchor(anchorId);
  await revalidateForShot(shotId);
  if (anchor) revalidatePath(`/episodes/${anchor.episodeId}`);
}
