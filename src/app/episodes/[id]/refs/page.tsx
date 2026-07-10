import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, references } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { ScreenHeader } from "@/components/ui";
import QueuePill from "@/components/QueuePill";
import GenPoller from "@/components/GenPoller";
import SeriesRefs from "@/components/refs/SeriesRefs";

export const dynamic = "force-dynamic";

/** Референсы серии (spec §2.6): один список на серию, токены REF_NN. */
export default async function RefsPage(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) notFound();

  const rows = await db
    .select()
    .from(references)
    .where(and(eq(references.episodeId, id), isNull(references.shotId), isNull(references.entityId)))
    .orderBy(asc(references.createdAt));

  const refs = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      token: r.token ?? "",
      caption: r.caption,
      source: r.source,
      width: r.width,
      height: r.height,
    })),
  );

  // активные задачи-референсы этой серии — пульсирующие плейсхолдеры в сетке
  const activeJobs = (
    await db
      .select()
      .from(generations)
      .where(and(eq(generations.kind, "reference"), inArray(generations.status, ["queued", "running"])))
      .orderBy(desc(generations.createdAt))
  ).filter((g) => g.episodeId === id);

  const epN = String(episode.number).padStart(2, "0");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${id}`}
        eyebrow={`Серия ${epN}`}
        title={`Референсы · ${refs.length}`}
        right={<QueuePill />}
      />
      <GenPoller activeCount={activeJobs.length} />
      <SeriesRefs
        episodeId={id}
        refs={refs}
        pendingJobs={activeJobs.map((g) => ({ id: g.id, model: g.model }))}
      />
    </main>
  );
}
