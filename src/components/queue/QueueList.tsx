"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelGeneration } from "@/lib/actions/generate";

interface QueueItem {
  id: string;
  status: string;
  model: string;
  credits: number | null;
  estimate?: number | null;
  createdAt: string;
  error: string;
  label: string;
  href: string;
}

const DOT: Record<string, string> = {
  queued: "var(--warning)",
  running: "var(--warning)",
  done: "var(--success)",
  failed: "var(--danger)",
  nsfw: "var(--danger)",
};

function Elapsed({ since }: { since: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const start = new Date(since).getTime();
    const update = () => setSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return (
    <span className="font-mono text-[11px] font-semibold text-warning">
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </span>
  );
}

export default function QueueList({
  items,
  cancellable = false,
}: {
  items: QueueItem[];
  cancellable?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const isActive = item.status === "queued" || item.status === "running";
        return (
          <div
            key={item.id}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
            style={{
              borderColor: isActive ? "rgba(192,138,62,.3)" : "var(--border-subtle)",
              background: isActive ? "var(--ink-600)" : "none",
            }}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "pulse-amber" : ""}`}
              style={{ background: DOT[item.status] ?? "var(--text-400)" }}
            />
            <Link href={item.href} className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-t100">
                {item.label}
              </span>
              <span className="block font-mono text-[9.5px] text-t400">
                {item.model}
                {isActive && item.estimate != null ? ` · ≈${item.estimate} кр` : ""}
                {item.error ? ` · ${item.error.slice(0, 60)}` : ""}
              </span>
            </Link>
            {isActive ? (
              <Elapsed since={item.createdAt} />
            ) : (
              <span className="font-mono text-[10px] text-t400">
                {item.status === "done" && item.credits != null
                  ? `−${item.credits} кр`
                  : item.status !== "done"
                    ? "отказ"
                    : ""}{" "}
                {new Date(item.createdAt).toLocaleTimeString("ru", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {cancellable && isActive && (
              <button
                aria-label="Отменить"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await cancelGeneration(item.id);
                    router.refresh();
                  })
                }
                className="flex h-8 w-8 items-center justify-center rounded-md text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
