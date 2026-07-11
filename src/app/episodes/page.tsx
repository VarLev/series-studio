import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listEpisodes, createEpisode } from "@/lib/actions/episodes";
import { deleteEpisode, deleteAllEpisodes } from "@/lib/actions/deletes";
import { getAllSettings } from "@/lib/settings";
import { EmptyState } from "@/components/ui";
import QueuePill from "@/components/QueuePill";
import ConfirmButton from "@/components/ConfirmButton";
import LongPressMenu from "@/components/LongPressMenu";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireAuth();
  const [episodes, settings] = await Promise.all([listEpisodes(), getAllSettings()]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <div className="px-4 pb-3 pt-6" style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}>
        <div className="eyebrow mb-1.5">Series Studio</div>
        <h1 className="chrome-text font-display text-[22px] font-bold uppercase leading-tight tracking-[0.06em]">
          {settings.series_title}
        </h1>
        <p className="mt-1.5 text-[11px] leading-relaxed text-t400">
          Выберите серию — сюжет, промпты и видео живут внутри неё.
        </p>
      </div>

      {/* быстрые входы в шапке (spec §2.1); основная навигация — таб-бар/сайдбар */}
      <nav className="flex gap-2 px-4 pb-4">
        <Link
          href="/bible"
          title="Библия сущностей"
          className="shrink-0 rounded-md border border-[var(--border-default)] bg-ink-600 px-3.5 py-2.5 font-mono text-[11px] font-semibold text-violet-100 hover:border-[var(--border-strong)] hover:bg-ink-500"
        >
          ❖ Библия
        </Link>
        <span className="flex-1" />
        <QueuePill />
      </nav>

      <div className="flex flex-col gap-2.5 px-4 pb-10">
        {episodes.map((ep) => (
          <LongPressMenu
            key={ep.id}
            title={`Серия ${String(ep.number).padStart(2, "0")} · ${ep.title || "Без названия"}`}
            deleteLabel="Удалить серию"
            confirmLabel="Точно удалить серию со всем содержимым?"
            doneToast="Серия удалена"
            action={deleteEpisode.bind(null, ep.id)}
          >
            <Link
              href={`/episodes/${ep.id}`}
              className="flex items-center gap-3.5 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3 hover:border-[var(--border-strong)]"
            >
              <div className="relative flex h-14 w-14 shrink-0 items-end overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600 p-1.5">
                <span className="chrome-text font-display text-[20px] font-bold leading-none tracking-[0.04em]">
                  {String(ep.number).padStart(2, "0")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-1">Серия {String(ep.number).padStart(2, "0")}</div>
                <div className="truncate text-[14px] font-semibold text-t100">
                  {ep.title || "Без названия"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-t400">
                  {ep.shotsTotal
                    ? `${ep.shotsApproved} из ${ep.shotsTotal} шотов утверждено`
                    : ep.synopsisMd
                      ? "сюжет написан · не раскадрован"
                      : "пустая серия"}
                </div>
              </div>
            </Link>
          </LongPressMenu>
        ))}

        {episodes.length === 0 && (
          <EmptyState>
            Серий пока нет. Создайте первую — напишете или сгенерируете сюжет, Claude разобьёт его
            на шоты, дальше промпты и генерация.
          </EmptyState>
        )}

        {episodes.length > 0 && (
          <div className="pt-1 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-t400">
            долгое зажатие по серии — удаление
          </div>
        )}

        <form action={createEpisode}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-[var(--border-default)] px-4 py-4 text-[12px] font-medium text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
          >
            + Новая серия — начните с сюжета
          </button>
        </form>

        {episodes.length > 1 && (
          <ConfirmButton
            action={deleteAllEpisodes}
            label={`Удалить все серии (${episodes.length})`}
            confirmLabel="Точно удалить ВСЕ серии и их содержимое?"
            doneToast="Все серии удалены"
            className="mt-2 min-h-11 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
          />
        )}
      </div>
    </main>
  );
}
