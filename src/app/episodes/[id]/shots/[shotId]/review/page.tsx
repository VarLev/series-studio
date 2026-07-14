import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, prompts, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import ReviewPlayer from "@/components/review/ReviewPlayer";

export const dynamic = "force-dynamic";

export default async function ReviewPage(ctx: {
  params: Promise<{ id: string; shotId: string }>;
  searchParams: Promise<{ g?: string }>;
}) {
  await requireAuth();
  const { id: episodeId, shotId } = await ctx.params;
  const { g } = await ctx.searchParams;
  const db = await getDb();

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.episodeId !== episodeId) notFound();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));

  const versionRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));
  const promptVersionById = new Map(versionRows.map((v) => [v.id, v.version]));
  const latest = versionRows[0] ?? null;
  const latestParams = latest
    ? (JSON.parse(latest.paramsJson || "{}") as {
        aspect_ratio?: string;
        duration?: number;
        quality?: string;
      })
    : {};

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.shotId, shotId))
    .orderBy(desc(generations.createdAt));
  const candidates = await Promise.all(
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
      })),
  );

  const siblings = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
  const next = siblings.find((s) => s.orderIndex === shot.orderIndex + 1) ?? null;

  const epN = String(episode?.number ?? 0).padStart(2, "0");
  const grpN = String(shot.orderIndex).padStart(2, "0");

  return (
    <ReviewPlayer
      episodeId={episodeId}
      shotId={shotId}
      shotLabel={`С${epN} · Г${grpN}`}
      shotTitle={shot.title || shot.actionMd.slice(0, 60)}
      shotStatus={shot.status}
      candidates={candidates}
      initialId={g ?? null}
      nextShot={next ? { id: next.id, label: String(next.orderIndex).padStart(2, "0") } : null}
      latestPromptId={latest?.id ?? null}
      latestVersion={latest?.version ?? 0}
      shotDurationSec={shot.durationSec}
      regenParams={{
        durationSec: latestParams.duration ?? shot.durationSec,
        aspectRatio: latestParams.aspect_ratio ?? "9:16",
        quality: latestParams.quality ?? "720p",
      }}
    />
  );
}
