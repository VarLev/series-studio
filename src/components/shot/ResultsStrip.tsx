"use client";

import { useTransition } from "react";
import { updateShot } from "@/lib/actions/shots";
import { setWinner } from "@/lib/actions/generations";

export interface ResultItem {
  id: string;
  model: string;
  status: string;
  source: string;
  error: string;
  url: string | null;
  isVideo: boolean;
  isWinner: boolean;
  createdAt: string;
}

export default function ResultsStrip({
  shotId,
  results,
}: {
  shotId: string;
  results: ResultItem[];
}) {
  const [, startTransition] = useTransition();

  return (
    <div className="flex snap-x gap-2.5 overflow-x-auto pb-2">
      {results.map((g) => (
        <div
          key={g.id}
          className="w-[230px] shrink-0 snap-start overflow-hidden rounded-lg border bg-ink-600"
          style={{ borderColor: g.isWinner ? "rgba(79,143,125,.5)" : "var(--border-subtle)" }}
        >
          {g.url ? (
            <div className="relative aspect-video bg-black">
              {g.isVideo ? (
                <video src={g.url} controls preload="metadata" className="h-full w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.url} alt="" className="h-full w-full object-cover" />
              )}
              {g.isWinner && (
                <span className="absolute right-1.5 top-1.5 rounded bg-success px-1.5 py-0.5 text-[9px] font-semibold text-ink-800">
                  ★ ПОБЕДИТЕЛЬ
                </span>
              )}
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-start justify-center gap-1.5 bg-[rgba(194,71,106,.06)] p-3">
              <span className="rounded-full border border-[rgba(194,71,106,.4)] bg-[rgba(194,71,106,.14)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#e08aa4]">
                {g.status === "nsfw" ? "Отказ · контент-фильтр" : "Ошибка"}
              </span>
              <span className="text-[10.5px] leading-snug text-t300">{g.error}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
            <span className="font-mono text-[10px] font-semibold text-chrome-mid">{g.model}</span>
            <span className="font-mono text-[9px] text-t400">{g.source}</span>
            <span className="flex-1" />
            {!g.isWinner && g.url && (
              <button
                onClick={() =>
                  startTransition(async () => {
                    await setWinner(shotId, g.id);
                    await updateShot(shotId, { status: "approved" });
                  })
                }
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.06em] text-t200 hover:border-success hover:text-success"
              >
                ★ Победитель
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
