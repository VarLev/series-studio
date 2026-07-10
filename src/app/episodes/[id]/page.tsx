import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, shots, shotEntities, entities } from "@/lib/db";
import { ScreenHeader } from "@/components/ui";
import EpisodeTabs from "@/components/episode/EpisodeTabs";
import type { ShotListItem } from "@/components/episode/ShotsList";

export const dynamic = "force-dynamic";

export default async function EpisodePage(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) notFound();

  const shotRows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, id))
    .orderBy(asc(shots.orderIndex));

  const links = shotRows.length
    ? await db
        .select()
        .from(shotEntities)
        .where(inArray(shotEntities.shotId, shotRows.map((s) => s.id)))
    : [];
  const entityIds = [...new Set(links.map((l) => l.entityId))];
  const entityRows = entityIds.length
    ? await db.select().from(entities).where(inArray(entities.id, entityIds))
    : [];
  const entityById = new Map(entityRows.map((e) => [e.id, e]));

  const shotItems: ShotListItem[] = shotRows.map((s) => ({
    id: s.id,
    orderIndex: s.orderIndex,
    title: s.title,
    action: s.actionMd,
    durationSec: s.durationSec,
    status: s.status,
    entityNames: links
      .filter((l) => l.shotId === s.id)
      .map((l) => entityById.get(l.entityId)?.name ?? "")
      .filter(Boolean),
  }));

  const epNumber = String(episode.number).padStart(2, "0");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={`Серия ${epNumber}`}
        title={episode.title || "Без названия"}
      />
      <EpisodeTabs
        episodeId={episode.id}
        initialTitle={episode.title}
        initialLogline={episode.logline}
        initialSynopsis={episode.synopsisMd}
        shots={shotItems}
      />
    </main>
  );
}
