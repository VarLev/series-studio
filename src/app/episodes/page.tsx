import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listEpisodes, createEpisode } from "@/lib/actions/episodes";
import { getAllSettings } from "@/lib/settings";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireAuth();
  const [episodes, settings] = await Promise.all([listEpisodes(), getAllSettings()]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <div className="px-4 pb-3 pt-6" style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}>
        <div className="eyebrow mb-1.5">Series Studio</div>
        <h1 className="chrome-text font-display text-[22px] font-bold uppercase leading-tight tracking-[0.06em]">
          {settings.series_title}
        </h1>
        <p className="mt-1.5 text-[11px] leading-relaxed text-t400">
          Выберите серию — сюжет, промпты и видео живут внутри неё.
        </p>
      </div>

      <nav className="flex gap-2 overflow-x-auto px-4 pb-4">
        {[
          { href: "/bible", label: "Библия" },
          { href: "/queue", label: "Очередь" },
          { href: "/costs", label: "Затраты и настройки" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-md border border-[var(--border-default)] bg-ink-600 px-3.5 py-2.5 font-mono text-[11px] font-semibold text-violet-100 hover:border-[var(--border-strong)] hover:bg-ink-500"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-2.5 px-4 pb-10">
        {episodes.map((ep) => (
          <Link
            key={ep.id}
            href={`/episodes/${ep.id}`}
            className="flex items-center gap-3.5 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3 hover:border-[var(--border-strong)] hover:bg-ink-600"
          >
            <div className="relative flex h-14 w-14 shrink-0 items-end overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600 p-1.5">
              <span className="chrome-text font-display text-[20px] font-bold leading-none tracking-[0.04em]">
                {String(ep.number).padStart(2, "0")}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-1">Серия {String(ep.number).padStart(2, "0")}</div>
              <div className="truncate text-[14px] font-semibold text-t100">
                {ep.title || "Без названия"}
              </div>
              <div className="mt-1 font-mono text-[10px] text-t400">
                {ep.shotsTotal
                  ? `${ep.shotsApproved} из ${ep.shotsTotal} шотов утверждено`
                  : ep.synopsisMd
                    ? "сюжет написан · не раскадрован"
                    : "пустая серия"}
              </div>
            </div>
          </Link>
        ))}

        {episodes.length === 0 && (
          <EmptyState>
            Серий пока нет. Создайте первую — напишете или сгенерируете сюжет, Claude разобьёт его
            на шоты, дальше промпты и генерация.
          </EmptyState>
        )}

        <form action={createEpisode}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-[var(--border-default)] px-4 py-4 text-[12px] font-medium text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
          >
            + Новая серия — начните с сюжета
          </button>
        </form>
      </div>
    </main>
  );
}
