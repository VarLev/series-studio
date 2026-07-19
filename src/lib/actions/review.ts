"use server";

import { asc, desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { parseBeatMarkers } from "@/lib/beatMarkers";
import { getDb, episodes, generations, prompts, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { safeParse } from "@/lib/params";
import type { Candidate } from "@/components/review/ReviewPlayer";

export type ShotReviewData = {
  episodeId: string;
  shotId: string;
  shotLabel: string;
  shotTitle: string;
  shotStatus: string;
  candidates: Candidate[];
  nextShot: { id: string; label: string } | null;
  latestPromptId: string | null;
  latestVersion: number;
  shotDurationSec: number;
  regenParams: { durationSec: number; aspectRatio: string; quality: string };
};

/**
 * Данные для ReviewPlayer по одной группе — та же выборка, что и review/page.tsx,
 * но как server action: галерея открывает плеер оверлеем и подтягивает кандидатов
 * лениво по клику, а не рендерит их все заранее.
 */
export async function getShotReviewData(shotId: string): Promise<ShotReviewData | null> {
  await requireAuth();
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return null;
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, shot.episodeId));

  const versionRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));
  const promptVersionById = new Map(versionRows.map((v) => [v.id, v.version]));
  const latest = versionRows[0] ?? null;
  const latestParams = safeParse<{ aspect_ratio?: string; duration?: number; quality?: string }>(
    latest?.paramsJson,
    {},
  );

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.shotId, shotId))
    .orderBy(desc(generations.createdAt));
  const candidates: Candidate[] = await Promise.all(
    genRows
      .filter((row) => row.status === "done" && row.resultStoragePath)
      .map(async (row) => ({
        id: row.id,
        model: row.model,
        url: await getFileUrl(row.resultStoragePath!),
        isVideo: Boolean(row.resultStoragePath!.match(/\.(mp4|webm|mov)$/i)),
        isWinner: row.winner,
        promptVersion: row.promptId ? (promptVersionById.get(row.promptId) ?? null) : null,
        credits: row.creditsSpent,
        source: row.source,
        beatMarkers: parseBeatMarkers(row.beatsJson),
      })),
  );

  const siblings = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, shot.episodeId))
    .orderBy(asc(shots.orderIndex));
  const next = siblings.find((s) => s.orderIndex === shot.orderIndex + 1) ?? null;

  const epN = String(episode?.number ?? 0).padStart(2, "0");
  const grpN = String(shot.orderIndex).padStart(2, "0");

  return {
    episodeId: shot.episodeId,
    shotId,
    shotLabel: `С${epN} · Г${grpN}`,
    shotTitle: shot.title || shot.actionMd.slice(0, 60),
    shotStatus: shot.status,
    candidates,
    nextShot: next ? { id: next.id, label: String(next.orderIndex).padStart(2, "0") } : null,
    latestPromptId: latest?.id ?? null,
    latestVersion: latest?.version ?? 0,
    shotDurationSec: shot.durationSec,
    regenParams: {
      durationSec: latestParams.duration ?? shot.durationSec,
      aspectRatio: latestParams.aspect_ratio ?? "9:16",
      quality: latestParams.quality ?? "720p",
    },
  };
}
