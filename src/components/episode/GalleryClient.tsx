"use client";

/**
 * Сетка галереи + плеер поверх неё. Клик по видео лениво тянет данные ревью
 * (getShotReviewData) и открывает ТОТ ЖЕ ReviewPlayer оверлеем — с метками,
 * покадровыми шагами, «Взять кадр», «Победитель». «Назад»/Escape закрывают
 * оверлей (onClose) и возвращают в галерею, не уводя на отдельную страницу.
 * В слайдере (inDrawer) оверлей — absolute, поэтому живёт ВНУТРИ панели слайдера,
 * а не растягивается на весь экран; на полной странице — fixed во всё окно.
 */
import { useState, useTransition } from "react";
import { getShotReviewData, type ShotReviewData } from "@/lib/actions/review";
import ReviewPlayer from "@/components/review/ReviewPlayer";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export type GalleryItem = {
  genId: string;
  shotId: string;
  shotOrder: number;
  shotTitle: string;
  model: string;
  winner: boolean;
  url: string;
  isVideo: boolean;
};

export default function GalleryClient({
  items,
  inDrawer = false,
}: {
  items: GalleryItem[];
  /** в слайдере оверлей плеера держим внутри панели (absolute), а не поверх всего окна (fixed) */
  inDrawer?: boolean;
}) {
  const t = useT();
  const [data, setData] = useState<ShotReviewData | null>(null);
  const [initialId, setInitialId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function open(shotId: string, genId: string) {
    setInitialId(genId);
    setOpeningId(genId);
    startTransition(async () => {
      try {
        const d = await getShotReviewData(shotId);
        if (!d || d.candidates.length === 0) {
          toast(t("Не удалось открыть плеер", "Could not open the player"));
        } else {
          setData(d);
        }
      } finally {
        setOpeningId(null);
      }
    });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.genId}
            className={`relative overflow-hidden rounded-xl border bg-ink-700 ${
              it.winner ? "border-violet-400" : "border-[var(--border-subtle)]"
            }`}
          >
            {it.winner && (
              <span
                title={t("Утверждённый шот (победитель)", "Approved shot (winner)")}
                className="absolute right-1.5 top-1.5 z-10 rounded-full bg-[rgba(6,5,9,.82)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-100"
                style={{ boxShadow: "var(--glow-violet-sm)" }}
              >
                ✓ {t("Утверждён", "Winner")}
              </span>
            )}
            <button
              onClick={() => open(it.shotId, it.genId)}
              title={t("Открыть в плеере", "Open in player")}
              className="group relative block w-full"
            >
              {it.isVideo ? (
                <video src={it.url} muted playsInline preload="metadata" className="aspect-[9/16] w-full bg-black object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
              )}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-colors group-hover:bg-[rgba(3,2,5,.28)]">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(6,5,9,.55)] text-white opacity-90 transition-opacity group-hover:opacity-100"
                  style={{ backdropFilter: "blur(2px)" }}
                >
                  {openingId === it.genId ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </span>
              </span>
            </button>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <span className="chrome-text font-display text-[14px] font-bold">
                {String(it.shotOrder).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-t200">{it.shotTitle}</span>
              <span className="shrink-0 font-mono text-[9px] text-t400">{it.model}</span>
              <a
                href={it.url}
                download
                title={t("Скачать", "Download")}
                className="shrink-0 rounded px-1 text-[13px] text-t400 hover:text-violet-200"
              >
                ⬇
              </a>
            </div>
          </div>
        ))}
      </div>

      {data && (
        <div className={`${inDrawer ? "absolute" : "fixed"} inset-0 z-50 bg-[#050505]`}>
          <ReviewPlayer {...data} initialId={initialId} onClose={() => setData(null)} />
        </div>
      )}
    </>
  );
}
