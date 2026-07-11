import Link from "next/link";
import { countActiveGenerations } from "@/lib/generation";

/** Индикатор активных задач «⏳ N» — виден в шапке, тап открывает очередь. */
export default async function QueuePill() {
  const active = await countActiveGenerations();
  return (
    <Link
      href="/queue"
      className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-default)] bg-ink-600 px-2.5 py-1.5 hover:border-[var(--border-strong)] hover:bg-ink-500"
      title="Queue"
    >
      <span className={`text-[13px] leading-none ${active > 0 ? "pulse-amber" : "opacity-55"}`}>
        ⏳
      </span>
      <span
        className={`font-mono text-[11px] font-semibold ${active > 0 ? "text-warning" : "text-t300"}`}
      >
        {active}
      </span>
    </Link>
  );
}
