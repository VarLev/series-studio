"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { exportEpisodeToCapCut } from "@/lib/actions/exports";

/**
 * Кнопка «Экспорт» на карточке эпизода. Панель с двумя опциями:
 *  - CapCut: server action создаёт папку-черновик прямо в проектах CapCut (видео
 *    на таймлайне в порядке серии) — тост с именем папки;
 *  - ZIP: скачивание всех видео эпизода одним архивом (attachment-роут).
 * Рендерится сиблингом карточки-ссылки (не внутри), поэтому её события не
 * конфликтуют с навигацией по карточке и long-press-удалением.
 */
export default function ExportButton({ episodeId }: { episodeId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function exportZip() {
    setOpen(false);
    // attachment-ответ: скачивание стартует, страница не переходит
    window.location.href = `/api/episodes/${episodeId}/export?scope=all`;
  }

  function exportCapCut() {
    startTransition(async () => {
      try {
        const res = await exportEpisodeToCapCut(episodeId);
        if (res.ok) {
          setOpen(false);
          toast(
            t(
              `Черновик CapCut создан: «${res.folder}» (${res.count} видео). Откройте/перезапустите CapCut.`,
              `CapCut draft created: “${res.folder}” (${res.count} videos). Open/restart CapCut.`,
            ),
          );
        } else {
          toast(res.error);
        }
      } catch {
        // ответ мог потеряться в туннеле на копировании видео — черновик мог создаться
        toast(
          t(
            "Связь прервалась — проверьте CapCut, черновик мог уже создаться",
            "Connection dropped — check CapCut, the draft may already exist",
          ),
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("Экспорт эпизода", "Export episode")}
        title={t("Экспорт", "Export")}
        onClick={() => setOpen(true)}
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-ink-600/85 text-[15px] text-t200 backdrop-blur-sm hover:border-[var(--border-strong)] hover:text-violet-200"
      >
        ⤓
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t("Экспорт эпизода", "Export episode")}>
        <div className="flex flex-col gap-2 pb-2 pt-1">
          <button
            type="button"
            onClick={exportCapCut}
            disabled={pending}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-violet-500 text-[12px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-violet-400 disabled:opacity-50"
          >
            {pending ? t("Создаю черновик…", "Creating draft…") : t("Экспорт в CapCut", "Export to CapCut")}
          </button>
          <button
            type="button"
            onClick={exportZip}
            disabled={pending}
            className="min-h-12 w-full rounded-lg border border-[var(--border-default)] text-[12px] font-semibold uppercase tracking-[0.08em] text-t200 hover:border-[var(--border-strong)] hover:bg-ink-600 disabled:opacity-50"
          >
            {t("Экспорт в ZIP", "Export to ZIP")}
          </button>
          <div className="px-1 pt-1 text-[10.5px] leading-relaxed text-t400">
            {t(
              "Экспортируются все готовые видео эпизода в порядке серии. CapCut-черновик создаётся в проектах CapCut на этом компьютере.",
              "Exports all finished videos of the episode in episode order. The CapCut draft is created in CapCut's projects on this computer.",
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-semibold text-t300 hover:bg-ink-600"
          >
            {t("Отмена", "Cancel")}
          </button>
        </div>
      </Sheet>
    </>
  );
}
