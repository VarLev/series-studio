"use client";

/** Шторка Nano Banana (spec §3.2): произвольный промпт, соотношение, разрешение → референс серии. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toaster";
import { startNanoBanana } from "@/lib/actions/generate";

const RATIOS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = [
  { id: "1k", label: "1K", credits: 4 },
  { id: "2k", label: "2K", credits: 6 },
  { id: "4k", label: "4K", credits: 10 },
] as const;

export default function NanoBananaSheet({
  open,
  onClose,
  episodeId,
  prefillPrompt = "",
}: {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  prefillPrompt?: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(prefillPrompt);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("16:9");
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]["id"]>("2k");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const credits = RESOLUTIONS.find((r) => r.id === resolution)?.credits ?? 6;

  // подставить промпт группы при открытии из шота
  const [prevPrefill, setPrevPrefill] = useState(prefillPrompt);
  if (prefillPrompt !== prevPrefill) {
    setPrevPrefill(prefillPrompt);
    if (!prompt.trim()) setPrompt(prefillPrompt);
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await startNanoBanana({
        episodeId,
        prompt: prompt.trim(),
        aspectRatio: ratio,
        resolution,
      });
      if (res.ok) {
        toast(`Nano Banana поставлен · ${credits} кр — референс появится в серии`);
        onClose();
        router.refresh();
      } else if ("error" in res) setError(res.error);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nano Banana · новый референс">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        autoFocus
        placeholder="Опишите изображение (на английском — точнее)…"
        className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
      />
      <div className="section-label mb-2 mt-3.5">Соотношение</div>
      <div className="flex gap-1.5">
        {RATIOS.map((r) => (
          <button
            key={r}
            onClick={() => setRatio(r)}
            className="min-h-10 flex-1 rounded-md border font-mono text-[11.5px] font-semibold"
            style={{
              borderColor: ratio === r ? "var(--border-strong)" : "var(--border-subtle)",
              background: ratio === r ? "var(--ink-600)" : "none",
              color: ratio === r ? "var(--text-100)" : "var(--text-400)",
            }}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="section-label mb-2 mt-3.5">Разрешение</div>
      <div className="flex gap-1.5">
        {RESOLUTIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => setResolution(r.id)}
            className="flex min-h-11 flex-1 flex-col items-center justify-center rounded-md border"
            style={{
              borderColor: resolution === r.id ? "var(--border-strong)" : "var(--border-subtle)",
              background: resolution === r.id ? "var(--ink-600)" : "none",
            }}
          >
            <span
              className="font-mono text-[12px] font-semibold"
              style={{ color: resolution === r.id ? "var(--text-100)" : "var(--text-400)" }}
            >
              {r.label}
            </span>
            <span className="font-mono text-[9px] text-t400">{r.credits} кр</span>
          </button>
        ))}
      </div>
      {error && <div className="mt-3 text-[11.5px] text-danger">{error}</div>}
      <button
        onClick={submit}
        disabled={pending || !prompt.trim()}
        className="mt-4 min-h-[52px] w-full rounded-lg bg-violet-500 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-50"
        style={{ boxShadow: "var(--glow-violet-sm)" }}
      >
        {pending ? "Отправка…" : `Нарисовать · ${credits} кр`}
      </button>
    </Sheet>
  );
}
