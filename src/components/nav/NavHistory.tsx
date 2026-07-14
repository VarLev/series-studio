"use client";

/**
 * Учёт глубины навигации внутри приложения, чтобы кнопка «назад» возвращала на
 * ФАКТИЧЕСКИ предыдущий экран (router.back()), а не на фиксированного «родителя».
 *
 * Проблема (замечание заказчика): из группы шотов открываешь Консоль, жмёшь
 * «назад» — и попадаешь в раздел серий, а не обратно в группу. Причина — кнопка
 * «назад» была захардкоженной ссылкой, а не переходом по истории.
 *
 * depth — сколько переходов «вперёд» мы сделали от точки входа (0 = точка входа,
 * ниже некуда). Растёт на push-переходах, убывает на наших back-переходах. Пока
 * depth > 0 — router.back() гарантированно остаётся внутри приложения; на нуле
 * кнопка уходит на запасной backHref (deep-link / холодный старт PWA), не выкидывая
 * пользователя из приложения.
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

let depth = 0;
let expectBack = false;
let lastPath: string | null = null;

/** Есть ли внутриприкладной экран, на который безопасно вернуться. */
export function canGoBack(): boolean {
  return depth > 0;
}

/** Помечает следующий переход как наш back — чтобы трекер уменьшил глубину. */
export function markBack(): void {
  expectBack = true;
}

/** Монтируется один раз в корневом layout: считает переходы по смене пути. */
export function NavHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    // первая отрисовка (точка входа) и повторные ре-раны с тем же путём
    // (StrictMode/refresh) навигацией не считаются
    if (lastPath === null) {
      lastPath = pathname;
      return;
    }
    if (lastPath === pathname) return;
    lastPath = pathname;
    if (expectBack) {
      expectBack = false;
      depth = Math.max(0, depth - 1);
    } else {
      depth += 1;
    }
  }, [pathname]);
  return null;
}
