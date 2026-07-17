"use client";

/**
 * Страховочная error-граница на всё приложение: до неё любой бросивший экшен или
 * упавший рендер сегмента показывали голое «Application error» вместо интерфейса.
 * Экшены обязаны возвращать Result и тостить ошибку сами — сюда долетает лишь то,
 * что не предусмотрели.
 *
 * Next 16.2: восстановление — unstable_retry() (перезапрашивает и перерисовывает
 * сегмент); reset() лишь чистит состояние границы без перезапроса.
 */
import { useEffect } from "react";
import { useT } from "@/components/I18nProvider";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-4">
      <span className="section-label">{t("Ошибка", "Error")}</span>
      <h1 className="text-[15px] font-semibold text-t100">
        {t("Что-то пошло не так", "Something went wrong")}
      </h1>
      <p className="text-[11.5px] leading-relaxed text-t400">
        {t(
          "Экран не удалось отрисовать. Данные не потеряны — попробуйте ещё раз.",
          "This screen failed to render. Nothing is lost — please try again.",
        )}
      </p>
      {/* в проде message серверных ошибок заменён на общий текст, остаётся digest
          для сверки с логами сервера — показываем то, что есть */}
      {(error.message || error.digest) && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t300">
          {error.message}
          {error.digest ? `\ndigest: ${error.digest}` : ""}
        </pre>
      )}
      <button
        onClick={() => unstable_retry()}
        className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
        style={{ boxShadow: "var(--glow-violet-sm)" }}
      >
        {t("Попробовать снова", "Try again")}
      </button>
    </main>
  );
}
