"use client";

/**
 * Правый выдвижной слайдер (90% ширины экрана) для второстепенных экранов —
 * рендерится intercepting-роутом ПОВЕРХ текущей страницы (перезагрузки нет,
 * состояние экрана под ним сохраняется). Закрытие = router.back(); по прямому
 * URL/перезагрузке тот же маршрут открывается полной страницей.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SideDrawer({
  title,
  nested = false,
  children,
}: {
  title: string;
  /**
   * Панель открыта поверх другой панели (напр. сущность поверх списка библии).
   * Меняет только ИКОНКУ на честную: действие одно и то же — router.back(), но
   * на вложенном уровне он возвращает к предыдущей панели, а не закрывает всё,
   * и «×» там врал бы.
   */
  nested?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.back();
    window.addEventListener("keydown", onKey);
    // блокируем скролл страницы под слайдером
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50">
      {/* затемнение — тап закрывает */}
      <div
        className="absolute inset-0 bg-[rgba(3,2,5,.6)]"
        style={{ backdropFilter: "blur(2px)" }}
        onClick={() => router.back()}
      />
      <aside
        className="drawer-slide-in absolute inset-y-0 right-0 flex w-[90%] max-w-xl flex-col border-l border-[var(--border-default)] bg-ink-800 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          {nested && (
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[16px] text-t400 hover:bg-ink-600 hover:text-t100"
            >
              ←
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-t100">{title}</span>
          {!nested && (
            <button
              onClick={() => router.back()}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[16px] text-t400 hover:bg-ink-600 hover:text-t100"
            >
              ×
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
