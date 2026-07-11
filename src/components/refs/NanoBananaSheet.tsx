"use client";

/** Шторка Nano Banana (spec §3.2): произвольный промпт, соотношение, разрешение → референс серии. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toaster";
import { startNanoBanana } from "@/lib/actions/generate";
import { useT } from "@/components/I18nProvider";
import { formatImageCost, type ImageModelMeta } from "@/lib/imageModels";

const RATIOS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = [
  { id: "1k", label: "1K" },
  { id: "2k", label: "2K" },
  { id: "4k", label: "4K" },
] as const;

export default function NanoBananaSheet({
  open,
  onClose,
  episodeId,
  prefillPrompt = "",
  models = [],
}: {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  prefillPrompt?: string;
  models?: ImageModelMeta[];
}) {
  const router = useRouter();
  const t = useT();
  const en = t("ru", "en") === "en";
  const [prompt, setPrompt] = useState(prefillPrompt);
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("16:9");
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]["id"]>("2k");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const activeModel = models.find((m) => m.id === model) ?? models[0];
  const cost = activeModel ? formatImageCost(activeModel.id, resolution, en) : "";

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
        model: activeModel?.id,
      });
      if (res.ok) {
        toast(
          t(
            `Nano Banana поставлен · ${cost} — референс появится в серии`,
            `Nano Banana queued · ${cost} — the reference will appear in the episode`,
          ),
        );
        onClose();
        router.refresh();
      } else if ("error" in res) setError(res.error);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Nano Banana · новый референс", "Nano Banana · new reference")}>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        autoFocus
        placeholder={t("Опишите изображение (на английском — точнее)…", "Describe the image (English works best)…")}
        className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
      />
      {models.length > 1 && (
        <>
          <div className="section-label mb-2 mt-3.5">{t("Модель", "Model")}</div>
          <div className="flex gap-1.5">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className="flex min-h-11 flex-1 flex-col items-center justify-center rounded-md border px-1"
                style={{
                  borderColor: activeModel?.id === m.id ? "var(--border-strong)" : "var(--border-subtle)",
                  background: activeModel?.id === m.id ? "var(--ink-600)" : "none",
                }}
              >
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: activeModel?.id === m.id ? "var(--text-100)" : "var(--text-400)" }}
                >
                  {m.label.replace("Nano Banana ", "")}
                </span>
                <span className="font-mono text-[8.5px] text-t400">{en ? m.hintEn : m.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-label mb-2 mt-3.5">{t("Соотношение", "Aspect ratio")}</div>
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
      <div className="section-label mb-2 mt-3.5">{t("Разрешение", "Resolution")}</div>
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
            <span className="font-mono text-[9px] text-t400">
              {formatImageCost(activeModel?.id ?? "", r.id, en)}
            </span>
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
        {pending ? t("Отправка…", "Submitting…") : t(`Нарисовать · ${cost}`, `Draw · ${cost}`)}
      </button>
    </Sheet>
  );
}
