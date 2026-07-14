"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";

const ITEMS = [
  { href: "/episodes", ru: "Серии", en: "Episodes", icon: "▤" },
  { href: "/bible", ru: "Библия", en: "Bible", icon: "❖" },
  { href: "/queue", ru: "Очередь", en: "Queue", icon: "⏳" },
  { href: "/console", ru: "Консоль", en: "Console", icon: "❯" },
  { href: "/settings", ru: "Настройки", en: "Settings", icon: "⚙" },
];

/**
 * Таб-бар виден на ВСЕХ экранах (кроме /login) — это главная навигация.
 * Экраны со своими нижними панелями (ActionBar шота) поднимают их НАД
 * таб-баром (bottom: var(--tabbar-h)), а не прячут его.
 * «Затраты» (/costs) переехали внутрь Настроек — своего таба у них больше нет.
 */

/** Нижний таб-бар (мобайл, spec §2.1) + сайдбар (десктоп, spec §4). */
export default function NavClient({ activeJobs }: { activeJobs: number }) {
  const pathname = usePathname();
  const t = useT();
  if (pathname === "/login") return null;

  const isActive = (href: string) =>
    href === "/episodes" ? pathname === "/episodes" || pathname.startsWith("/episodes/") : pathname.startsWith(href);

  return (
    <>
      {/* мобильный таб-бар — всегда */}
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
                  {t(item.ru, item.en)}
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

      {/* десктопный сайдбар */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-[var(--border-subtle)] bg-ink-900 lg:flex"
      >
        <div className="px-4 pb-4 pt-6">
          <div className="eyebrow mb-1">Series Studio</div>
          <div className="chrome-text font-display text-[15px] font-bold uppercase tracking-[0.06em]">
            {t("Пульт", "Console")}
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
                {t(item.ru, item.en)}
                {item.href === "/queue" && activeJobs > 0 && (
                  <span className="pulse-amber ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[9px] font-bold text-ink-900">
                    {activeJobs}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/**
 * Обёртка контента: отступ под сайдбар (десктоп) и таб-бар (мобайл, все экраны).
 * Класс content-shell используется в globals.css, чтобы min-h-dvh страниц не
 * складывался с высотой таб-бара — иначе пустые экраны скроллятся на его высоту.
 */
export function ContentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return <div className="content-shell pb-16 lg:pb-0 lg:pl-56">{children}</div>;
}
