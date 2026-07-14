import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes } from "@/lib/db";
import { ScreenHeader } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import RefsContent from "./RefsContent";

export const dynamic = "force-dynamic";

/**
 * Референсы серии (spec §2.6): один список на серию, токены REF_NN.
 * Полная страница — только по прямому URL/перезагрузке; при навигации с экрана
 * эпизода этот маршрут перехватывается правым слайдером (@drawer/(.)refs).
 */
export default async function RefsPage(ctx: { params: Promise<{ id: string }> }) {
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
        title={t("Референсы серии", "Episode references")}
      />
      <RefsContent episodeId={id} />
    </main>
  );
}
