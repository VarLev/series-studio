import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, generations, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { getT } from "@/lib/i18n-server";
import { EmptyState } from "@/components/ui";

/**
 * Содержимое галереи победителей без обёртки страницы — используется и полной
 * страницей, и правым слайдером (intercepting-роут @drawer/(.)gallery).
 */
export default async function GalleryContent({ episodeId }: { episodeId: string }) {
  const db = await getDb();
  const shotRows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
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

  const t = await getT();

  return (
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
                <img src={url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
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
          href={`/api/episodes/${episodeId}/export`}
          className="flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-strong)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200 hover:border-violet-400 hover:text-violet-100"
        >
          {t("Скачать всё (zip) ↓", "Download all (zip) ↓")}
        </a>
      )}
    </div>
  );
}
