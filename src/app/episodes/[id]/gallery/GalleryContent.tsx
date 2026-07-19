import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, generations, shots } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { getT } from "@/lib/i18n-server";
import { EmptyState } from "@/components/ui";
import GalleryClient, { type GalleryItem } from "@/components/episode/GalleryClient";

/**
 * Содержимое галереи эпизода без обёртки страницы — используется и полной
 * страницей, и правым слайдером (intercepting-роут @drawer/(.)gallery).
 * Показывает ВСЕ готовые видео шотов; утверждённые (winner) помечены. Сама сетка
 * и плеер-оверлей живут в GalleryClient (клиент): клик открывает ReviewPlayer
 * поверх галереи, «назад» возвращает в неё.
 */
export default async function GalleryContent({ episodeId }: { episodeId: string }) {
  const db = await getDb();
  const shotRows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
  const shotById = new Map(shotRows.map((s) => [s.id, s]));
  const videos = shotRows.length
    ? await db
        .select()
        .from(generations)
        .where(
          and(
            eq(generations.kind, "video"),
            eq(generations.status, "done"),
            inArray(generations.shotId, shotRows.map((s) => s.id)),
          ),
        )
    : [];
  // порядок: по шоту; внутри шота утверждённый (winner) сверху, затем по времени
  videos.sort((a, b) => {
    const ao = shotById.get(a.shotId!)?.orderIndex ?? 0;
    const bo = shotById.get(b.shotId!)?.orderIndex ?? 0;
    if (ao !== bo) return ao - bo;
    if (a.winner !== b.winner) return a.winner ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const items: GalleryItem[] = await Promise.all(
    videos
      .filter((g) => g.shotId && g.resultStoragePath)
      .map(async (g) => {
        const shot = shotById.get(g.shotId!)!;
        return {
          genId: g.id,
          shotId: g.shotId!,
          shotOrder: shot.orderIndex,
          shotTitle: shot.title || shot.actionMd.slice(0, 50),
          model: g.model,
          winner: g.winner,
          url: await getFileUrl(g.resultStoragePath!),
          isVideo: Boolean(g.resultStoragePath!.match(/\.(mp4|webm|mov)$/i)),
        };
      }),
  );
  const hasWinner = items.some((it) => it.winner);

  const t = await getT();

  return (
    <div className="flex flex-col gap-3 p-4 pb-10">
      {items.length === 0 && (
        <EmptyState>
          {t(
            "Видео пока нет. Сгенерируйте шоты — их результаты появятся здесь.",
            "No videos yet. Generate shots — their results show up here.",
          )}
        </EmptyState>
      )}
      {items.length > 0 && <GalleryClient items={items} />}
      {/* zip собирает финальную сборку — только утверждённые (winner) */}
      {hasWinner && (
        <a
          href={`/api/episodes/${episodeId}/export`}
          className="flex min-h-12 items-center justify-center rounded-lg border border-[var(--border-strong)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200 hover:border-violet-400 hover:text-violet-100"
        >
          {t("Скачать утверждённые (zip) ↓", "Download approved (zip) ↓")}
        </a>
      )}
    </div>
  );
}
