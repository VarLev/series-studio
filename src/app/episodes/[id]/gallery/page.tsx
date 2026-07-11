import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { getT } from "@/lib/i18n-server";
import { ScreenHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/** M5 — галерея эпизода: ВСЕ видео-победители (у шота их может быть несколько) + zip. */
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
  const shotById = new Map(shotRows.map((s) => [s.id, s]));
  const winners = shotRows.length
    ? await db
        .select()
        .from(generations)
        .where(
          and(
            eq(generations.winner, true),
            eq(generations.status, "done"),
            inArray(generations.shotId, shotRows.map((s) => s.id)),
          ),
        )
    : [];
  // порядок: по шоту, внутри шота — по времени создания
  winners.sort((a, b) => {
    const ao = shotById.get(a.shotId!)?.orderIndex ?? 0;
    const bo = shotById.get(b.shotId!)?.orderIndex ?? 0;
    return ao - bo || a.createdAt.getTime() - b.createdAt.getTime();
  });

  const items = await Promise.all(
    winners
      .filter((g) => g.shotId && g.resultStoragePath)
      .map(async (g) => ({
        genId: g.id,
        shot: shotById.get(g.shotId!)!,
        model: g.model,
        url: await getFileUrl(g.resultStoragePath!),
        isVideo: Boolean(g.resultStoragePath!.match(/\.(mp4|webm|mov)$/i)),
      })),
  );

  const epN = String(episode.number).padStart(2, "0");
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${id}`}
        eyebrow={`${t("Серия", "Episode")} ${epN}`}
        title={t(`Галерея · ${items.length} побед.`, `Gallery · ${items.length} winners`)}
      />
      <div className="flex flex-col gap-3 p-4 pb-10">
        {items.length === 0 && (
          <EmptyState>
            {t(
              "Утверждённых шотов пока нет. Выберите «Победителя» в ревью — шот попадёт сюда.",
              "No approved shots yet. Pick a Winner in review — the shot lands here.",
            )}
          </EmptyState>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {items.map(({ genId, shot, url, isVideo, model }) => (
            <div
              key={genId}
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
                <span className="shrink-0 font-mono text-[9px] text-t400">{model}</span>
                {url && (
                  <a
                    href={url}
                    download
                    title={t("Скачать", "Download")}
                    className="shrink-0 rounded px-1 text-[13px] text-t400 hover:text-violet-200"
                  >
                    ⬇
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <a
            href={`/api/episodes/${id}/export`}
            className="flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-strong)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200 hover:border-violet-400 hover:text-violet-100"
          >
            {t("Скачать всё (zip) ↓", "Download all (zip) ↓")}
          </a>
        )}
      </div>
    </main>
  );
}
