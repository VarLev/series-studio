"use client";

/**
 * Кнопка «назад» с учётом истории: если внутри приложения есть куда возвращаться
 * (canGoBack) — идём по истории браузера на фактически предыдущий экран, сохраняя
 * его состояние (Client Cache App Router). Иначе (прямой заход по ссылке, холодный
 * старт PWA) — на запасной backHref-родитель, чтобы не выйти из приложения.
 */
import { useRouter } from "next/navigation";
import { canGoBack, markBack } from "./NavHistory";

export default function BackButton({
  fallbackHref,
  className,
  ariaLabel = "Back",
  children,
}: {
  fallbackHref: string;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        if (canGoBack()) {
          markBack();
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className}
    >
      {children}
    </button>
  );
}
