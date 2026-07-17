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
let expectReplace = false;
let lastPath: string | null = null;
let lastBasePath: string | null = null;

/**
 * Маршруты вкладок, которые ВНУТРИ приложения открываются правой панелью
 * (перехват @panel/(.)*). По прямому URL и перезагрузке те же адреса — обычные
 * полные страницы, поэтому список нужен именно для навигации: панель это ОДИН
 * слой поверх экрана, а не череда экранов.
 */
const PANEL_ROUTES = ["/bible", "/queue", "/console", "/settings", "/costs", "/knowledge", "/rules"];

export function isPanelRoute(path: string): boolean {
  return PANEL_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

/** Экран ПОД панелью — последний маршрут, который панелью не является. */
export function basePath(): string | null {
  return lastBasePath;
}

/** Есть ли внутриприкладной экран, на который безопасно вернуться. */
export function canGoBack(): boolean {
  return depth > 0;
}

/** Помечает следующий переход как наш back — чтобы трекер уменьшил глубину. */
export function markBack(): void {
  expectBack = true;
}

/**
 * Помечает следующий переход как replace: адрес меняется, а запись в истории —
 * нет, значит и глубину двигать нельзя (иначе счётчик уплывает вверх и «назад»
 * начинает считать, что внутри приложения есть куда возвращаться).
 */
export function markReplace(): void {
  expectReplace = true;
}

/** Монтируется один раз в корневом layout: считает переходы по смене пути. */
export function NavHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    // экран под панелью помним всегда, включая точку входа
    if (!isPanelRoute(pathname)) lastBasePath = pathname;
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
    } else if (expectReplace) {
      expectReplace = false;
    } else {
      depth += 1;
    }
  }, [pathname]);
  return null;
}
