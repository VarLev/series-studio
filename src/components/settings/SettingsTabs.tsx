"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";

/**
 * Подвкладки раздела «Пульт»: Настройки и Затраты (бывшая вкладка «Cost»,
 * переехавшая внутрь Настроек). Живут на /settings и /costs.
 */
const TABS = [
  { href: "/settings", ru: "Настройки", en: "Settings" },
  { href: "/costs", ru: "Затраты", en: "Costs" },
  { href: "/rules", ru: "База правил", en: "Rules" },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="flex gap-1.5 px-4 pb-1 pt-1">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
