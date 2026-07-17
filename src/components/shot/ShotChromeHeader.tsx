"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { ScreenHeader } from "@/components/ui";
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
          // очередь убрана из шапки — нижний таб-бар с бейджем теперь на всех экранах
          current?.isInsert ? (
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
          ) : undefined
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
