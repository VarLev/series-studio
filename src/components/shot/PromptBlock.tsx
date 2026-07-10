"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import PromptText from "./PromptText";
import { generateShotPrompt } from "@/lib/actions/prompts";

export interface PromptVersion {
  id: string;
  version: number;
  text: string;
  negativePrompt: string;
  targetModel: string;
  feedbackNote: string;
  createdAt: string;
}

export default function PromptBlock({
  shotId,
  episodeId,
  versions,
  tokens,
  targetModels,
}: {
  shotId: string;
  episodeId: string;
  versions: PromptVersion[];
  tokens: string[];
  targetModels: string[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [model, setModel] = useState(targetModels[0] ?? "kling-3.0");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const current = versions[0] ?? null;

  function onGenerate() {
    setError("");
    startTransition(async () => {
      const res = await generateShotPrompt(shotId, model);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-700">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <span className="section-label">Промпт · Claude → видеомодель</span>
        {current && (
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded border border-[rgba(178,95,208,.32)] bg-[rgba(178,95,208,.1)] px-2 py-0.5 font-mono text-[10px] font-semibold text-magenta-400 hover:bg-[rgba(178,95,208,.2)]"
          >
            v{current.version}
          </button>
        )}
        <span className="flex-1" />
        {current && (
          <>
            <button
              onClick={copy}
              title="Скопировать промпт"
              className="flex h-7 w-7 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-violet-200"
            >
              {copied ? "✓" : "⧉"}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="px-0.5 py-1.5 text-[10.5px] text-t300 hover:text-violet-200"
            >
              {expanded ? "свернуть" : "развернуть"}
            </button>
          </>
        )}
      </div>

      {current ? (
        <button
          onClick={() => router.push(`/episodes/${episodeId}/shots/${shotId}/editor`)}
          className="block w-full text-left"
        >
          <div
            className="relative overflow-hidden transition-[max-height]"
            style={{ maxHeight: expanded ? "2000px" : "108px" }}
          >
            <div className="whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-[1.7] text-t200">
              <PromptText text={current.text} tokens={tokens} />
            </div>
            {!expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-ink-700" />
            )}
          </div>
          {current.negativePrompt && expanded && (
            <div className="border-t border-[var(--border-subtle)] p-3 font-mono text-[10.5px] leading-relaxed text-t400">
              negative: {current.negativePrompt}
            </div>
          )}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-2.5 p-4">
          <div className="text-[12px] leading-relaxed text-t300">
            <span className="text-violet-600">✦</span>&nbsp; Промпта ещё нет. Claude соберёт его из
            фрагмента сюжета, сущностей и базы знаний.
          </div>
          <div className="flex w-full flex-wrap items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
            >
              {targetModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              onClick={onGenerate}
              disabled={pending}
              className="min-h-10 flex-1 rounded-md bg-violet-500 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? "Фабрика работает…" : "Сгенерировать промпт"}
            </button>
          </div>
          {error && <div className="text-[11px] text-danger">{error}</div>}
        </div>
      )}

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="История версий">
        <div className="flex flex-col gap-2.5 pb-2">
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => router.push(`/episodes/${episodeId}/shots/${shotId}/editor?v=${v.id}`)}
              className="rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 text-left hover:border-[var(--border-strong)]"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[11px] font-semibold text-magenta-400">
                  v{v.version}
                </span>
                <span className="font-mono text-[9.5px] text-chrome-mid">{v.targetModel}</span>
                <span className="ml-auto font-mono text-[9.5px] text-t400">
                  {v.feedbackNote === "Ручная правка" ? "ручная правка" : "фабрика"} ·{" "}
                  {new Date(v.createdAt).toLocaleString("ru")}
                </span>
              </div>
              {v.feedbackNote && (
                <div className="mb-1.5 text-[11px] italic text-t300">«{v.feedbackNote}»</div>
              )}
              <div className="line-clamp-4 whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-t400">
                {v.text}
              </div>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
