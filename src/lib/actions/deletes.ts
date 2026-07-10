"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getDb,
  episodes,
  generations,
  knowledgeDocs,
  prompts,
  references,
  shots,
  shotEntities,
  entities,
} from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import type { EntityType } from "./entities";

/** Удалить файл в хранилище, только если на него не ссылается другая запись references/generations. */
async function maybeDeleteBlob(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const db = await getDb();
  const refUses = await db.select().from(references).where(eq(references.storagePath, storagePath));
  const genUses = await db
    .select()
    .from(generations)
    .where(eq(generations.resultStoragePath, storagePath));
  if (refUses.length === 0 && genUses.length === 0) await deleteFile(storagePath).catch(() => {});
}

async function deleteGenerationRow(genId: string): Promise<string | null> {
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, genId));
  if (!gen) return null;
  await db.delete(generations).where(eq(generations.id, genId));
  await maybeDeleteBlob(gen.resultStoragePath);
  return gen.shotId;
}

async function deleteShotDeep(shotId: string): Promise<void> {
  const db = await getDb();
  const gens = await db.select().from(generations).where(eq(generations.shotId, shotId));
  for (const g of gens) {
    await db.delete(generations).where(eq(generations.id, g.id));
    await maybeDeleteBlob(g.resultStoragePath);
  }
  const shotRefs = await db.select().from(references).where(eq(references.shotId, shotId));
  for (const r of shotRefs) {
    await db.delete(references).where(eq(references.id, r.id));
    await maybeDeleteBlob(r.storagePath);
  }
  await db.delete(prompts).where(eq(prompts.shotId, shotId));
  await db.delete(shotEntities).where(eq(shotEntities.shotId, shotId));
  await db.delete(shots).where(eq(shots.id, shotId));
}

// ---------- Генерации ----------

export async function deleteGeneration(genId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const shotId = await deleteGenerationRow(genId);
  if (shotId) {
    // если удалили победителя — снять пометку
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (shot?.winnerGenerationId === genId) {
      await db.update(shots).set({ winnerGenerationId: null }).where(eq(shots.id, shotId));
    }
    const { recalcShotStatus } = await import("@/lib/generation");
    await recalcShotStatus(shotId);
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
  }
}

export async function deleteAllGenerations(shotId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const gens = await db.select().from(generations).where(eq(generations.shotId, shotId));
  for (const g of gens) await deleteGenerationRow(g.id);
  await db.update(shots).set({ winnerGenerationId: null }).where(eq(shots.id, shotId));
  const { recalcShotStatus } = await import("@/lib/generation");
  await recalcShotStatus(shotId);
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
}

// ---------- Шоты ----------

export async function deleteShot(shotId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  await deleteShotDeep(shotId);
  revalidatePath(`/episodes/${shot.episodeId}`);
  redirect(`/episodes/${shot.episodeId}`);
}

export async function deleteAllShots(episodeId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  for (const s of rows) await deleteShotDeep(s.id);
  revalidatePath(`/episodes/${episodeId}`);
}

// ---------- Эпизоды ----------

async function deleteEpisodeDeep(episodeId: string): Promise<void> {
  const db = await getDb();
  const shotRows = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  for (const s of shotRows) await deleteShotDeep(s.id);
  // референсы серии + задачи-референсы
  const serieRefs = await db.select().from(references).where(eq(references.episodeId, episodeId));
  for (const r of serieRefs) {
    await db.delete(references).where(eq(references.id, r.id));
    await maybeDeleteBlob(r.storagePath);
  }
  const refGens = await db.select().from(generations).where(eq(generations.episodeId, episodeId));
  for (const g of refGens) {
    await db.delete(generations).where(eq(generations.id, g.id));
    await maybeDeleteBlob(g.resultStoragePath);
  }
  await db.delete(episodes).where(eq(episodes.id, episodeId));
}

export async function deleteEpisode(episodeId: string): Promise<void> {
  await requireAuth();
  await deleteEpisodeDeep(episodeId);
  revalidatePath("/episodes");
  redirect("/episodes");
}

export async function deleteAllEpisodes(): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(episodes);
  for (const e of rows) await deleteEpisodeDeep(e.id);
  revalidatePath("/episodes");
}

// ---------- Референсы серии ----------

export async function deleteAllSeriesRefs(episodeId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db
    .select()
    .from(references)
    .where(
      and(eq(references.episodeId, episodeId), isNull(references.shotId), isNull(references.entityId)),
    );
  for (const r of rows) {
    await db.delete(references).where(eq(references.id, r.id));
    await maybeDeleteBlob(r.storagePath);
  }
  revalidatePath(`/episodes/${episodeId}/refs`);
}

// ---------- Сущности (по группам) ----------

export async function deleteAllEntities(type: EntityType): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(entities).where(eq(entities.type, type));
  const ids = rows.map((e) => e.id);
  if (ids.length) {
    await db.delete(shotEntities).where(inArray(shotEntities.entityId, ids));
    const refs = await db.select().from(references).where(inArray(references.entityId, ids));
    for (const r of refs.filter((x) => !x.shotId)) {
      await db.delete(references).where(eq(references.id, r.id));
      await maybeDeleteBlob(r.storagePath);
    }
    await db.delete(entities).where(inArray(entities.id, ids));
  }
  revalidatePath("/bible");
}

// ---------- База знаний ----------

export async function deleteKnowledgeDoc(id: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
  revalidatePath("/costs");
}

export async function clearKnowledge(): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(knowledgeDocs);
  for (const d of rows) await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, d.id));
  revalidatePath("/costs");
}
