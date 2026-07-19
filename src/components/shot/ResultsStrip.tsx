"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { cancelGeneration, probeGeneration, retryGeneration } from "@/lib/actions/generate";
import { toggleWinner } from "@/lib/actions/generations";
import { deleteGeneration } from "@/lib/actions/deletes";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

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
  promptVersion: number | null;
  credits: number | null;
  /** job id провайдера — доказательство, что Higgsfield принял задачу */
  jobId: string | null;
  /** последняя ошибка связи при поллинге статуса (если есть) */
  pollError: string | null;
  /** сколько фото-образов персонажей прикреплено к задаче (image_references) */
  characterRefs: number;
  /** провайдер задачи (higgsfield-mcp | kling-mcp | …) — для подписи на карточке */
  provider: string;
}

function Elapsed({ since }: { since: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const start = new Date(since).getTime();
    const update = () => setSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return (
    <span className="font-mono text-[15px] font-semibold text-warning">
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </span>
  );
}

export default function ResultsStrip({
  episodeId,
  shotId,
  results,
}: {
  episodeId: string;
  shotId: string;
  results: ResultItem[];
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  // звезда «победителя» переключается мгновенно, сервер догоняет в фоне
  const [optimisticWinners, flipWinner] = useOptimistic(
    results,
    (state, id: string) => state.map((r) => (r.id === id ? { ...r, isWinner: !r.isWinner } : r)),
  );

  return (
    <div className="flex snap-x gap-2.5 overflow-x-auto pb-2">
      {optimisticWinners.map((g) => {
        const active = g.status === "queued" || g.status === "running";
        const failed = g.status === "failed" || g.status === "nsfw";
        return (
          <div
            key={g.id}
            className="w-[150px] shrink-0 snap-start overflow-hidden rounded-lg border bg-ink-600"
            style={{
              borderColor: g.isWinner
                ? "rgba(79,143,125,.5)"
                : active
                  ? "rgba(192,138,62,.35)"
                  : "var(--border-subtle)",
            }}
          >
            {active && (
              <div
                className="flex aspect-[9/16] flex-col items-center justify-center gap-1.5 px-2 text-center"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, var(--ink-700) 0 12px, var(--ink-600) 12px 24px)",
                }}
              >
                <span className="pulse-amber h-2.5 w-2.5 rounded-full bg-warning" />
                <Elapsed since={g.createdAt} />
                <span className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-t400">
                  {g.provider.startsWith("kling") ? "Kling" : "Higgsfield"} ·{" "}
                  {g.status === "queued" ? t("в очереди", "queued") : t("в работе", "running")}
                </span>
                {/* доказательство приёма: job id, выданный Higgsfield при сабмите */}
                {g.jobId && (
                  <span className="font-mono text-[8.5px] text-success">
                    ✓ {t("принята", "accepted")} · {g.jobId.slice(0, 8)}
                  </span>
                )}
                {g.pollError && (
                  <span className="font-mono text-[8.5px] leading-snug text-warning">
                    ⚠ {t("нет связи — статус может отставать", "no link — status may lag")}
                  </span>
                )}
              </div>
            )}

            {failed && (
              <div className="flex aspect-[9/16] flex-col items-start justify-center gap-1.5 bg-[rgba(194,71,106,.06)] p-3">
                <span className="rounded-full border border-[rgba(194,71,106,.4)] bg-[rgba(194,71,106,.14)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#e08aa4]">
                  {g.status !== "nsfw"
                    ? t("Ошибка", "Error")
                    : /ip_detected/i.test(g.error ?? "")
                      ? // провайдер увидел «реального человека» в референсах — это не NSFW
                        t("Отказ · распознан реальный человек", "Refused · real-person match")
                      : t("Отказ · контент-фильтр", "Refused · content filter")}
                </span>
                <span title={g.error ?? undefined} className="line-clamp-3 text-[10.5px] leading-snug text-t300">
                  {g.error}
                </span>
              </div>
            )}

            {g.status === "done" && g.url && (
              <Link
                href={`/episodes/${episodeId}/shots/${shotId}/review?g=${g.id}`}
                className="relative block aspect-[9/16] bg-black"
              >
                {g.isVideo ? (
                  <video src={g.url} preload="metadata" muted className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                )}
                <span
                  className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(212,198,232,.5)]"
                  style={{ background: "rgba(139,95,176,.28)", backdropFilter: "blur(6px)" }}
                >
                  ▶
                </span>
                {g.isWinner && (
                  <span className="absolute right-1.5 top-1.5 rounded bg-success px-1.5 py-0.5 text-[9px] font-semibold text-ink-800">
                    {t("★ ПОБЕДИТЕЛЬ", "★ WINNER")}
                  </span>
                )}
              </Link>
            )}

            {/* футер фиксированной структуры: [модель·v] / [кредиты | действия] —
                длинные имена моделей обрезаются, кнопки не «прыгают» между карточками */}
            <div className="px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-chrome-mid">
                  {g.model}
                </span>
                {g.promptVersion != null && (
                  <span className="shrink-0 font-mono text-[10px] text-magenta-400">v{g.promptVersion}</span>
                )}
              </div>
              <div className="mt-1 flex min-h-7 items-center gap-1.5">
                <span className="font-mono text-[10px] text-t300">
                  {g.credits != null ? `${g.credits} ${t("кр", "cr")}` : g.source}
                </span>
                {g.characterRefs > 0 && (
                  <span
                    title={t("Прикреплено фото-образов персонажей", "Character reference photos attached")}
                    className="font-mono text-[10px] text-success"
                  >
                    🎭 {g.characterRefs}
                  </span>
                )}
                <span className="flex-1" />
                {active ? (
                  <>
                    {/* живой опрос статуса по требованию — подтверждение, что задача идёт */}
                    <button
                      disabled={pending}
                      title={t("Проверить статус в Higgsfield", "Check status at Higgsfield")}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await probeGeneration(g.id);
                          toast(
                            res.pollError
                              ? t(
                                  `Нет связи с Higgsfield: ${res.pollError.slice(0, 80)}`,
                                  `No link to Higgsfield: ${res.pollError.slice(0, 80)}`,
                                )
                              : t(`Higgsfield: ${res.status}`, `Higgsfield: ${res.status}`),
                          );
                        })
                      }
                      className="rounded-md px-1.5 py-1 text-[11px] text-t400 hover:bg-ink-500 hover:text-violet-200 disabled:opacity-50"
                    >
                      ↻
                    </button>
                    <button
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await cancelGeneration(g.id);
                        })
                      }
                      className="rounded-md px-2 py-1 text-[10px] font-semibold text-t300 hover:bg-ink-500 hover:text-t100 disabled:opacity-50"
                    >
                      {t("Отменить", "Cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {g.status === "done" && g.url && (
                      <>
                        {/* тумблер победителя: их может быть несколько, все идут в галерею */}
                        <button
                          title={g.isWinner ? t("Снять победителя", "Unmark winner") : t("Пометить победителем", "Mark as winner")}
                          onClick={() =>
                            startTransition(async () => {
                              flipWinner(g.id);
                              await toggleWinner(g.id);
                            })
                          }
                          className="rounded px-1 text-[13px] disabled:opacity-50"
                          style={{ color: g.isWinner ? "var(--success)" : "var(--text-400)" }}
                        >
                          {g.isWinner ? "★" : "☆"}
                        </button>
                        <a
                          href={g.url}
                          download
                          title={t("Скачать видео", "Download video")}
                          className="rounded px-1 text-[12px] text-t400 hover:text-violet-200"
                        >
                          ⬇
                        </a>
                      </>
                    )}
                    <ConfirmButton
                      action={deleteGeneration.bind(null, g.id)}
                      label="🗑"
                      confirmLabel={t("Удалить?", "Delete?")}
                      className="rounded px-1 text-[11px] text-t400 hover:text-danger disabled:opacity-50"
                      armedClassName="text-danger"
                    />
                  </>
                )}
              </div>
            </div>

            {failed && (
              <div className="flex gap-1.5 px-2.5 pb-2.5">
                <Link
                  href={`/episodes/${episodeId}/shots/${shotId}/editor?reason=${encodeURIComponent(g.error.slice(0, 200))}`}
                  className="flex-1 rounded-md border border-[var(--border-strong)] px-2 py-2 text-center text-[10px] font-semibold leading-tight text-violet-100 hover:border-violet-400"
                >
                  {t("Исправить промпт", "Fix prompt")}
                </Link>
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await retryGeneration(g.id);
                    })
                  }
                  className="rounded-md px-2.5 py-2 text-[10px] font-semibold text-t300 hover:bg-ink-500 hover:text-t100 disabled:opacity-50"
                >
                  {t("Повторить", "Retry")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
