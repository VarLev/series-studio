"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots, shotEntities, references } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

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
  revalidatePath(`/episodes/${shot.episodeId}`);
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
