import Link from "next/link";
import { countActiveGenerations } from "@/lib/generation";

/** Индикатор активных задач «⏳ N» — виден в шапке, тап открывает очередь. */
export default async function QueuePill() {
  const active = await countActiveGenerations();
  return (
    <Link
      href="/queue"
      className="flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 hover:border-[var(--border-strong)] hover:bg-ink-500"
      title="Очередь задач"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${active > 0 ? "pulse-amber bg-warning" : "bg-ink-300"}`}
      />
      <span className="font-mono text-[11px] font-semibold text-t100">
        {active > 0 ? active : "—"}
      </span>
    </Link>
  );
}
