"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, generations, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { recalcShotStatus } from "@/lib/generation";

/**
 * Победителей у шота может быть НЕСКОЛЬКО (замечание заказчика): флаг на
 * каждой генерации, тумблер ★. Все победители эпизода попадают в галерею.
 */
export async function toggleWinner(
  generationId: string,
): Promise<{ winner: boolean }> {
  await requireAuth();
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!gen) return { winner: false };
  const next = !gen.winner;
  await db.update(generations).set({ winner: next }).where(eq(generations.id, generationId));
  if (gen.shotId) {
    await recalcShotStatus(gen.shotId);
    const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
    if (shot) {
      revalidatePath(`/episodes/${shot.episodeId}/shots/${gen.shotId}`);
      revalidatePath(`/episodes/${shot.episodeId}/gallery`);
      revalidatePath(`/episodes/${shot.episodeId}`);
    }
  }
  return { winner: next };
}
