"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/episodes", label: "Серии", icon: "▤" },
  { href: "/bible", label: "Библия", icon: "❖" },
  { href: "/queue", label: "Очередь", icon: "⏳" },
  { href: "/costs", label: "Затраты", icon: "◔" },
  { href: "/settings", label: "Настройки", icon: "⚙" },
];

const HOTKEYS: Array<[string, string]> = [
  ["J / K", "след. / пред. шот"],
  ["G", "генерация"],
  ["P", "промпт"],
  ["← →", "покадрово"],
  ["Space", "play / pause"],
  ["Enter", "победитель"],
  ["Esc", "назад"],
];

/**
 * Таб-бар живёт только на четырёх верхних экранах: на вложенных (карточка шота,
 * серия, референсы) у экранов свои нижние панели — таб-бар их перекрывал.
 */
const TOP_LEVEL = ["/episodes", "/bible", "/queue", "/costs", "/settings"];

/** Нижний таб-бар (мобайл, spec §2.1) + сайдбар (десктоп, spec §4). */
export default function NavClient({ activeJobs }: { activeJobs: number }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  const showTabBar = TOP_LEVEL.includes(pathname);

  const isActive = (href: string) =>
    href === "/episodes" ? pathname === "/episodes" || pathname.startsWith("/episodes/") : pathname.startsWith(href);

  return (
    <>
      {/* мобильный таб-бар */}
      {showTabBar && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border-default)] lg:hidden"
          style={{
            background: "linear-gradient(180deg, rgba(15,12,22,.96), rgba(6,5,9,.99))",
            backdropFilter: "blur(14px)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1"
                style={{ color: active ? "var(--violet-200)" : "var(--text-400)" }}
              >
                <span className="text-[16px] leading-none">{item.icon}</span>
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em]">
                  {item.label}
                </span>
                {item.href === "/queue" && activeJobs > 0 && (
                  <span className="pulse-amber absolute right-[calc(50%-22px)] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-bold text-ink-900">
                    {activeJobs}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}

      {/* десктопный сайдбар */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-[var(--border-subtle)] bg-ink-900 lg:flex"
      >
        <div className="px-4 pb-4 pt-6">
          <div className="eyebrow mb-1">Series Studio</div>
          <div className="chrome-text font-display text-[15px] font-bold uppercase tracking-[0.06em]">
            Пульт
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[12.5px] font-medium"
                style={{
                  background: active ? "var(--ink-600)" : "none",
                  color: active ? "var(--text-100)" : "var(--text-300)",
                }}
              >
                <span className="w-4 text-center">{item.icon}</span>
                {item.label}
                {item.href === "/queue" && activeJobs > 0 && (
                  <span className="pulse-amber ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-bold text-ink-900">
                    {activeJobs}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-4 pb-5">
          <div className="section-label mb-2">Горячие клавиши</div>
          <div className="flex flex-col gap-1">
            {HOTKEYS.map(([key, label]) => (
              <div key={key} className="flex items-center gap-2 text-[10px] text-t400">
                <span className="rounded border border-[var(--border-subtle)] bg-ink-700 px-1.5 py-0.5 font-mono text-[9px] text-t300">
                  {key}
                </span>
                {label}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

/** Обёртка контента: отступ под сайдбар/таб-бар (таб-бар — только на верхних экранах). */
export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  const showTabBar = TOP_LEVEL.includes(pathname);
  return (
    <div className={`lg:pl-56 ${showTabBar ? "pb-16 lg:pb-0" : ""}`}>{children}</div>
  );
}
