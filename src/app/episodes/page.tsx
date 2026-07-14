import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listEpisodes } from "@/lib/actions/episodes";
import { deleteEpisode, deleteAllEpisodes } from "@/lib/actions/deletes";
import { getAllSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { EmptyState } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import LongPressMenu from "@/components/LongPressMenu";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireAuth();
  const [episodes, settings] = await Promise.all([listEpisodes(), getAllSettings()]);
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <div className="px-4 pb-3 pt-6" style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}>
        <div className="eyebrow mb-1.5">Series Studio</div>
        <h1 className="chrome-text font-display text-[22px] font-bold uppercase leading-tight tracking-[0.06em]">
          {settings.series_title}
        </h1>
        <p className="mt-1.5 text-[11px] leading-relaxed text-t400">
          {t(
            "Выберите серию — сюжет, промпты и видео живут внутри неё.",
            "Pick an episode — its story, prompts and videos live inside.",
          )}
        </p>
      </div>

      {/* быстрые входы убраны: Библия и Очередь дублировали нижний таб-бар,
          который теперь виден на всех экранах */}
      <div className="flex flex-col gap-2.5 px-4 pb-10">
        {episodes.map((ep) => (
          <LongPressMenu
            key={ep.id}
            title={`${t("Серия", "Episode")} ${String(ep.number).padStart(2, "0")} · ${ep.title || t("Без названия", "Untitled")}`}
            deleteLabel={t("Удалить серию", "Delete episode")}
            confirmLabel={t(
              "Точно удалить серию со всем содержимым?",
              "Really delete this episode with everything inside?",
            )}
            doneToast={t("Серия удалена", "Episode deleted")}
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
                <div className="eyebrow mb-1">
                  {t("Серия", "Episode")} {String(ep.number).padStart(2, "0")}
                </div>
                <div className="truncate text-[14px] font-semibold text-t100">
                  {ep.title || t("Без названия", "Untitled")}
                </div>
                <div className="mt-1 font-mono text-[10px] text-t400">
                  {ep.shotsTotal
                    ? t(
                        `${ep.shotsApproved} из ${ep.shotsTotal} шотов утверждено`,
                        `${ep.shotsApproved} of ${ep.shotsTotal} shots approved`,
                      )
                    : ep.synopsisMd
                      ? t("сюжет написан · не раскадрован", "story written · not storyboarded")
                      : t("пустая серия", "empty episode")}
                </div>
              </div>
            </Link>
          </LongPressMenu>
        ))}

        {episodes.length === 0 && (
          <EmptyState>
            {t(
              "Серий пока нет. Создайте первую — напишете или сгенерируете сюжет, Claude разобьёт его на шоты, дальше промпты и генерация.",
              "No episodes yet. Create the first one — write or generate a story, Claude splits it into shots, then prompts and generation.",
            )}
          </EmptyState>
        )}

        {episodes.length > 0 && (
          <div className="pt-1 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-t400">
            {t("долгое зажатие по серии — удаление", "long-press an episode to delete")}
          </div>
        )}

        {/* серия НЕ создаётся по клику — только когда в черновике появится текст */}
        <Link
          href="/episodes/new"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-[var(--border-default)] px-4 py-4 text-[12px] font-medium text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          {t("+ Новая серия — начните с сюжета", "+ New episode — start with the story")}
        </Link>

        {episodes.length > 1 && (
          <ConfirmButton
            action={deleteAllEpisodes}
            label={t(`Удалить все серии (${episodes.length})`, `Delete all episodes (${episodes.length})`)}
            confirmLabel={t(
              "Точно удалить ВСЕ серии и их содержимое?",
              "Really delete ALL episodes and their contents?",
            )}
            doneToast={t("Все серии удалены", "All episodes deleted")}
            className="mt-2 min-h-11 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
          />
        )}
      </div>
    </main>
  );
}
