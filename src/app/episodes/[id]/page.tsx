import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, shots, shotEntities, entities } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import Link from "next/link";
import { ScreenHeader } from "@/components/ui";
import EpisodeTabs from "@/components/episode/EpisodeTabs";
import QueuePill from "@/components/QueuePill";
import type { ShotListItem } from "@/components/episode/ShotsList";

export const dynamic = "force-dynamic";

export default async function EpisodePage(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) notFound();
  const settings = await getAllSettings();

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
        right={
          <div className="flex items-center gap-1.5">
            <Link
              href={`/episodes/${episode.id}/refs`}
              title="Референсы серии"
              className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 font-mono text-[11px] font-semibold text-violet-200 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              REF
            </Link>
            <Link
              href={`/episodes/${episode.id}/gallery`}
              title="Галерея утверждённых шотов"
              className="flex min-h-8 items-center rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 font-mono text-[11px] font-semibold text-t100 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              ▦
            </Link>
            <QueuePill />
          </div>
        }
      />
      <EpisodeTabs
        episodeId={episode.id}
        initialTitle={episode.title}
        initialLogline={episode.logline}
        initialSynopsis={episode.synopsisMd}
        shots={shotItems}
        synopsisModel={settings.llm_model_synopsis}
        breakdownModel={settings.llm_model}
      />
    </main>
  );
}
