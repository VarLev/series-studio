import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { ScreenHeader, EmptyState } from "@/components/ui";
import GenPoller from "@/components/GenPoller";
import QueueList from "@/components/queue/QueueList";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  await requireAuth();
  const db = await getDb();

  const gens = await db
    .select()
    .from(generations)
    .orderBy(desc(generations.createdAt))
    .limit(200);
  const shotIds = [...new Set(gens.map((g) => g.shotId))];
  const shotRows = shotIds.length
    ? await db.select().from(shots).where(inArray(shots.id, shotIds))
    : [];
  const shotById = new Map(shotRows.map((s) => [s.id, s]));
  const epIds = [...new Set(shotRows.map((s) => s.episodeId))];
  const epRows = epIds.length
    ? await db.select().from(episodes).where(inArray(episodes.id, epIds))
    : [];
  const epById = new Map(epRows.map((e) => [e.id, e]));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const toItem = (g: (typeof gens)[number]) => {
    const shot = shotById.get(g.shotId);
    const ep = shot ? epById.get(shot.episodeId) : undefined;
    return {
      id: g.id,
      status: g.status,
      model: g.model,
      credits: g.creditsSpent,
      createdAt: g.createdAt.toISOString(),
      error: g.error ?? "",
      label: shot
        ? `С${String(ep?.number ?? 0).padStart(2, "0")} · Г${String(shot.orderIndex).padStart(2, "0")} — ${shot.title || shot.actionMd.slice(0, 40)}`
        : "Шот удалён",
      href: shot ? `/episodes/${shot.episodeId}/shots/${shot.id}` : "/episodes",
    };
  };

  const active = gens.filter((g) => g.status === "queued" || g.status === "running").map(toItem);
  const doneToday = gens
    .filter((g) => g.status !== "queued" && g.status !== "running" && g.createdAt >= startOfDay)
    .map(toItem);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/episodes" eyebrow="Higgsfield · все серии" title="Очередь задач" />
      <GenPoller activeCount={active.length} />
      <div className="flex flex-col gap-3 p-4 pb-10">
        <div className="section-label">Активные · {active.length}</div>
        {active.length ? (
          <QueueList items={active} cancellable />
        ) : (
          <EmptyState>Сейчас ничего не генерируется.</EmptyState>
        )}

        <div className="section-label mt-3">Завершено сегодня · {doneToday.length}</div>
        {doneToday.length ? (
          <QueueList items={doneToday} />
        ) : (
          <EmptyState>Сегодня завершённых задач нет.</EmptyState>
        )}

        <Link
          href="/costs"
          className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-300 hover:text-violet-200"
        >
          Затраты по эпизодам →
        </Link>
      </div>
    </main>
  );
}
