"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { ScreenHeader } from "@/components/ui";
import { ImageIcon, FilmIcon } from "@/components/icons";
import ConfirmButton from "@/components/ConfirmButton";
import ShotHotkeys from "@/components/shot/ShotHotkeys";
import { deleteShot } from "@/lib/actions/deletes";
import { useT } from "@/components/I18nProvider";
import type { NavShot } from "@/lib/shotChrome";

/**
 * Шапка карточки группы + горячие клавиши. Живёт в layout'е, поэтому текущую
 * группу берёт не из props (layout не перерендеривается при смене [shotId]), а
 * из useSelectedLayoutSegment() — единственный способ узнать дочерний сегмент
 * (layout.md: «Layouts do not have access to the route segments below itself»).
 * Побочный выигрыш: заголовок и номер группы меняются мгновенно, по тапу, не
 * дожидаясь сервера.
 */
export default function ShotChromeHeader({
  episodeId,
  episodeNumber,
  shots,
}: {
  episodeId: string;
  episodeNumber: number;
  shots: NavShot[];
}) {
  const t = useT();
  const shotId = useSelectedLayoutSegment();
  const idx = shots.findIndex((s) => s.id === shotId);
  const current = idx >= 0 ? shots[idx] : null;

  const epN = String(episodeNumber).padStart(2, "0");
  const grpN = current?.isInsert ? "✦" : String(current?.displayNo ?? 0).padStart(2, "0");
  const grpLabel = current?.isInsert ? t("Вставка", "Insert") : `${t("Группа", "Group")} ${grpN}`;
  const shotHref = (s: NavShot) => `/episodes/${episodeId}/shots/${s.id}`;
  const prev = idx > 0 ? shots[idx - 1] : null;
  const next = idx >= 0 ? (shots[idx + 1] ?? null) : null;

  return (
    <>
      <ScreenHeader
        backHref={`/episodes/${episodeId}`}
        eyebrow={`${t("Серия", "Episode")} ${epN} · ${grpLabel}`}
        title={current?.title || t("Группа шотов", "Shot group")}
        right={
          // Ref (референсы серии) и Галерея — доступны из любой группы. Со страницы
          // группы ведут полной страницей, а не слайдером: intercepting @drawer
          // перехватывает эти адреса только с уровня эпизода (docs: (.) — тот же
          // уровень сегментов; группа на два сегмента глубже).
          // lg:mr — увести иконки левее фиксированной панели действий (ActionBar:
          // fixed right-0 w-[196px] z-30 в десктопе), иначе они уходят под неё и
          // не кликаются
          <div className="flex items-center gap-1.5 lg:mr-[200px]">
            <Link
              href={`/episodes/${episodeId}/refs`}
              title={t("Референсы серии", "Episode references")}
              className="flex min-h-8 items-center justify-center rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 text-violet-200 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              <ImageIcon />
            </Link>
            <Link
              href={`/episodes/${episodeId}/gallery`}
              title={t("Галерея утверждённых шотов", "Approved shots gallery")}
              className="flex min-h-8 items-center justify-center rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 text-t100 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              <FilmIcon />
            </Link>
            {current?.isInsert && (
              <ConfirmButton
                action={() => deleteShot(current.id)}
                label={t("Удалить вставку", "Delete insert")}
                confirmLabel={t(
                  "Точно удалить эту вставную группу?",
                  "Really delete this insert group?",
                )}
                className="min-h-8 rounded-full border border-[rgba(194,71,106,.4)] bg-ink-600 px-3 py-1.5 font-mono text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
                armedClassName="border-danger bg-[rgba(194,71,106,.15)] text-[#e08aa4]"
              />
            )}
          </div>
        }
      />
      {shotId && (
        <ShotHotkeys
          prevHref={prev ? shotHref(prev) : null}
          nextHref={next ? shotHref(next) : null}
          editorHref={`/episodes/${episodeId}/shots/${shotId}/editor`}
          backHref={`/episodes/${episodeId}`}
        />
      )}
    </>
  );
}
