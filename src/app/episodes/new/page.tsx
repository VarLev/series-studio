import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes } from "@/lib/db";
import { getT } from "@/lib/i18n-server";
import { ScreenHeader } from "@/components/ui";
import NewEpisodeEditor from "@/components/episode/NewEpisodeEditor";

export const dynamic = "force-dynamic";

/** Черновик новой серии: записи в БД ещё нет — она появится с первым текстом. */
export default async function NewEpisodePage() {
  await requireAuth();
  const db = await getDb();
  const [last] = await db.select().from(episodes).orderBy(desc(episodes.number)).limit(1);
  const nextNumber = String((last?.number ?? 0) + 1).padStart(2, "0");
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={`${t("Серия", "Episode")} ${nextNumber}`}
        title={t("Новая серия", "New episode")}
      />
      <NewEpisodeEditor />
    </main>
  );
}
