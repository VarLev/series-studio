"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function setWinner(shotId: string, generationId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(shots).set({ winnerGenerationId: generationId }).where(eq(shots.id, shotId));
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
}
