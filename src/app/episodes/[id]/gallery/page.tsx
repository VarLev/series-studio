import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { ScreenHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/** M5 — галерея эпизода: approved-шоты по порядку + «скачать всё» (zip). */
export default async function GalleryPage(ctx: { params: Promise<{ id: string }> }) {
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
  const approved = shotRows.filter((s) => s.status === "approved" && s.winnerGenerationId);
  const winnerIds = approved.map((s) => s.winnerGenerationId!) ?? [];
  const gens = winnerIds.length
    ? await db.select().from(generations).where(inArray(generations.id, winnerIds))
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));

  const items = await Promise.all(
    approved.map(async (s) => {
      const gen = genById.get(s.winnerGenerationId!);
      return {
        shot: s,
        model: gen?.model ?? "",
        url: gen?.resultStoragePath ? await getFileUrl(gen.resultStoragePath) : null,
        isVideo: Boolean(gen?.resultStoragePath?.match(/\.(mp4|webm|mov)$/i)),
      };
    }),
  );

  const epN = String(episode.number).padStart(2, "0");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${id}`}
        eyebrow={`Серия ${epN}`}
        title={`Галерея · ${items.length} утверждено`}
      />
      <div className="flex flex-col gap-3 p-4 pb-10">
        {items.length === 0 && (
          <EmptyState>
            Утверждённых шотов пока нет. Выберите «Победителя» в ревью — шот попадёт сюда.
          </EmptyState>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {items.map(({ shot, url, isVideo }) => (
            <div
              key={shot.id}
              className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-ink-700"
            >
              {url &&
                (isVideo ? (
                  <video src={url} controls preload="metadata" className="aspect-[9/16] w-full bg-black object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="aspect-[9/16] w-full object-cover" />
                ))}
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="chrome-text font-display text-[14px] font-bold">
                  {String(shot.orderIndex).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-t200">
                  {shot.title || shot.actionMd.slice(0, 50)}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-t400">{shot.durationSec}s</span>
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <a
            href={`/api/episodes/${id}/export`}
            className="flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-strong)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200 hover:border-violet-400 hover:text-violet-100"
          >
            Скачать всё (zip) ↓
          </a>
        )}
      </div>
    </main>
  );
}
