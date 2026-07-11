import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { ScreenHeader, EmptyState } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import GenPoller from "@/components/GenPoller";
import QueueList from "@/components/queue/QueueList";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  await requireAuth();
  const db = await getDb();
  const t = await getT();

  const gens = await db
    .select()
    .from(generations)
    .orderBy(desc(generations.createdAt))
    .limit(200);
  const shotIds = [...new Set(gens.map((g) => g.shotId).filter((x): x is string => Boolean(x)))];
  const shotRows = shotIds.length
    ? await db.select().from(shots).where(inArray(shots.id, shotIds))
    : [];
  const shotById = new Map(shotRows.map((s) => [s.id, s]));
  const epIds = [
    ...new Set([
      ...shotRows.map((s) => s.episodeId),
      ...gens.map((g) => g.episodeId).filter((x): x is string => Boolean(x)),
    ]),
  ];
  const epRows = epIds.length
    ? await db.select().from(episodes).where(inArray(episodes.id, epIds))
    : [];
  const epById = new Map(epRows.map((e) => [e.id, e]));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const toItem = (g: (typeof gens)[number]) => {
    const shot = g.shotId ? shotById.get(g.shotId) : undefined;
    const ep = shot ? epById.get(shot.episodeId) : g.episodeId ? epById.get(g.episodeId) : undefined;
    const params = JSON.parse(g.paramsJson || "{}") as {
      estimate?: number | null;
      _poll?: { error?: string };
    };
    const label =
      g.kind === "reference"
        ? t(
            `Референс серии С${String(ep?.number ?? 0).padStart(2, "0")} · ${g.model}`,
            `Episode reference E${String(ep?.number ?? 0).padStart(2, "0")} · ${g.model}`,
          )
        : shot
          ? `${t("С", "E")}${String(ep?.number ?? 0).padStart(2, "0")} · ${t("Г", "G")}${String(shot.orderIndex).padStart(2, "0")} — ${shot.title || shot.actionMd.slice(0, 40)}`
          : t("Шот удалён", "Shot deleted");
    return {
      id: g.id,
      status: g.status,
      model: g.model,
      credits: g.creditsSpent,
      estimate: params.estimate ?? null,
      createdAt: g.createdAt.toISOString(),
      // для активных задач показываем ошибку связи поллинга (если есть)
      error: g.error || (params._poll?.error ? t("⚠ нет связи с провайдером", "⚠ no link to provider") : ""),
      label,
      href:
        g.kind === "reference"
          ? `/episodes/${g.episodeId}/refs`
          : shot
            ? `/episodes/${shot.episodeId}/shots/${shot.id}`
            : "/episodes",
    };
  };

  const active = gens.filter((g) => g.status === "queued" || g.status === "running").map(toItem);
  const doneToday = gens
    .filter((g) => g.status !== "queued" && g.status !== "running" && g.createdAt >= startOfDay)
    .map(toItem);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={t("Higgsfield · все серии", "Higgsfield · all episodes")}
        title={t("Очередь задач", "Job queue")}
      />
      <GenPoller activeCount={active.length} />
      <div className="flex flex-col gap-3 p-4 pb-10">
        <div className="section-label">{t("Активные", "Active")} · {active.length}</div>
        {active.length ? (
          <QueueList items={active} cancellable />
        ) : (
          <EmptyState>{t("Сейчас ничего не генерируется.", "Nothing is generating right now.")}</EmptyState>
        )}

        <div className="section-label mt-3">{t("Завершено сегодня", "Finished today")} · {doneToday.length}</div>
        {doneToday.length ? (
          <QueueList items={doneToday} />
        ) : (
          <EmptyState>{t("Сегодня завершённых задач нет.", "No finished jobs today.")}</EmptyState>
        )}

        <Link
          href="/costs"
          className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-300 hover:text-violet-200"
        >
          {t("Затраты по эпизодам →", "Costs by episode →")}
        </Link>
      </div>
    </main>
  );
}
