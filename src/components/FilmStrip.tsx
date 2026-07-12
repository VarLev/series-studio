"use client";

import Link from "next/link";
import { SHOT_STATUS } from "@/lib/statuses";
import { useT } from "@/components/I18nProvider";

export interface StripShot {
  id: string;
  orderIndex: number;
  status: string;
  thumbUrl: string | null;
}

/**
 * Кинолента (spec §2.3): полоса миниатюр всех шотов серии — цвет рамки = статус,
 * янтарный пульс = генерация, тап = переход. Навигация и прогресс-бар одновременно.
 */
export default function FilmStrip({
  episodeId,
  shots,
  currentShotId,
}: {
  episodeId: string;
  shots: StripShot[];
  currentShotId?: string;
}) {
  const t = useT();
  if (shots.length < 2) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-ink-900 px-3.5 py-2">
      {shots.map((s) => {
        const st = SHOT_STATUS[s.status] ?? SHOT_STATUS.draft;
        const current = s.id === currentShotId;
        return (
          <Link
            key={s.id}
            href={`/episodes/${episodeId}/shots/${s.id}`}
            className="w-[38px] shrink-0"
            title={`${t("Группа", "Group")} ${String(s.orderIndex).padStart(2, "0")} · ${t(st.ru, st.en)}`}
          >
            <span
              className="relative block aspect-[9/16] overflow-hidden rounded border-[1.5px] bg-ink-600"
              style={{
                borderColor: st.color,
                boxShadow: current ? "var(--glow-violet-sm)" : "none",
              }}
            >
              {s.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[9px] text-t400">
                  ✦
                </span>
              )}
              {s.status === "generating" && (
                <span className="pulse-amber absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />
              )}
            </span>
            <span
              className="mt-0.5 block text-center font-mono text-[9.5px] font-medium tracking-[0.1em]"
              style={{ color: current ? "var(--text-100)" : "var(--text-400)" }}
            >
              {String(s.orderIndex).padStart(2, "0")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
