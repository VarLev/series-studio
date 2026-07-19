import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { ScreenHeader } from "@/components/ui";
import GalleryContent from "./GalleryContent";

export const dynamic = "force-dynamic";

/**
 * M5 — галерея эпизода: ВСЕ готовые видео шотов; утверждённые (winner) помечены.
 * Полная страница — только по прямому URL/перезагрузке; при навигации с экрана
 * эпизода этот маршрут перехватывается правым слайдером (@drawer/(.)gallery).
 */
export default async function GalleryPage(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) notFound();

  const epN = String(episode.number).padStart(2, "0");
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${id}`}
        eyebrow={`${t("Серия", "Episode")} ${epN}`}
        title={t("Галерея", "Gallery")}
      />
      <GalleryContent episodeId={id} />
    </main>
  );
}
