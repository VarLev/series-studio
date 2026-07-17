"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { isPanelRoute, markReplace } from "@/components/nav/NavHistory";

/**
 * Подвкладки раздела «Пульт»: Настройки, База знаний, Затраты и База правил —
 * все четыре перехвачены правой панелью.
 *
 * Внутри панели переключение вкладок идёт REPLACE, а не push: панель — ОДИН слой
 * поверх экрана, и каждая вкладка не должна оставлять по записи в истории. Иначе
 * «×» (router.back()) отматывал на предыдущую вкладку — тоже перехваченную — и
 * панель вместо закрытия показывала её.
 */
const TABS = [
  { href: "/settings", ru: "Настройки", en: "Settings" },
  { href: "/knowledge", ru: "База знаний", en: "Knowledge" },
  { href: "/costs", ru: "Затраты", en: "Costs" },
  { href: "/rules", ru: "База правил", en: "Rules" },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  const t = useT();
  const inPanel = isPanelRoute(pathname);
  return (
    <div className="flex gap-1.5 px-4 pb-1 pt-1">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            replace={inPanel}
            onClick={() => {
              // клик по своей же вкладке навигации не делает — метку не ставим,
              // иначе она повиснет и съест глубину следующего перехода
              if (inPanel && pathname !== tab.href) markReplace();
            }}
            className="min-h-9 flex-1 rounded-lg border px-3 text-center text-[11.5px] font-semibold leading-9"
            style={{
              borderColor: active ? "var(--border-strong)" : "var(--border-subtle)",
              background: active ? "var(--ink-600)" : "transparent",
              color: active ? "var(--text-100)" : "var(--text-400)",
            }}
          >
            {t(tab.ru, tab.en)}
          </Link>
        );
      })}
    </div>
  );
}
