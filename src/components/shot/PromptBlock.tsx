"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import PromptText from "./PromptText";
import { generateShotPrompt } from "@/lib/actions/prompts";
import { LLM_MODELS } from "@/lib/llm/models";
import { estTextUsd, OUT_TOKENS, fmtUsd } from "@/lib/pricing";
import { useT } from "@/components/I18nProvider";

export interface PromptVersion {
  id: string;
  version: number;
  text: string;
  negativePrompt: string;
  targetModel: string;
  feedbackNote: string;
  createdAt: string;
}

export interface UsedTechnique {
  id: string;
  title: string;
  category: string;
  camera: string;
  lens: string;
  lighting: string;
  tags: string;
  prompt: string;
  negative: string;
}

export default function PromptBlock({
  shotId,
  episodeId,
  versions,
  tokens,
  targetModels,
  llmModel,
  usedTechniques = [],
}: {
  shotId: string;
  episodeId: string;
  versions: PromptVersion[];
  tokens: string[];
  targetModels: string[];
  llmModel: string;
  usedTechniques?: UsedTechnique[];
}) {
  const router = useRouter();
  const t = useT();
  const en = t("ru", "en") === "en";
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [model, setModel] = useState(targetModels[0] ?? "kling-3.0");
  // выбор LLM-модели для промпт-фабрики (какая ИИ пишет промпт)
  const [factoryModel, setFactoryModel] = useState(llmModel);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [technique, setTechnique] = useState<UsedTechnique | null>(null);
  const current = versions[0] ?? null;
  // фабрика: ~4К входных токенов (шаблон+библия+приёмы) + типовой вывод
  const genUsd = estTextUsd(factoryModel, 4000, OUT_TOKENS.prompt);

  function openEditor() {
    router.push(`/episodes/${episodeId}/shots/${shotId}/editor`);
  }

  function onGenerate() {
    setError("");
    startTransition(async () => {
      const res = await generateShotPrompt(shotId, model, factoryModel);
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
        <span className="section-label">{t("Промпт · Claude → видеомодель", "Prompt · Claude → video model")}</span>
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
              title={t("Скопировать промпт", "Copy prompt")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-violet-200"
            >
              {copied ? "✓" : "⧉"}
            </button>
            <button
              onClick={openEditor}
              title={t("Редактировать промпт", "Edit prompt")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-violet-200"
            >
              ✎
            </button>
          </>
        )}
      </div>

      {current ? (
        <>
        {/* клик по тексту — раскрыть/свернуть (не открывать редактор; правка по ✎) */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className="block w-full cursor-pointer text-left"
        >
          <div
            className="relative overflow-hidden transition-[max-height]"
            style={{ maxHeight: expanded ? "4000px" : "108px" }}
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
        </div>
        {/* режиссёрские приёмы, вплетённые фабрикой в промпт (тап — открыть приём) */}
        {usedTechniques.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-2">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-t400">
              {t("приёмы:", "techniques:")}
            </span>
            {usedTechniques.map((t) => (
              <button
                key={t.id}
                onClick={() => setTechnique(t)}
                title={t.title}
                className="flex h-7 w-10 items-center justify-center rounded-md border border-[var(--border-default)] bg-ink-600 text-[12px] hover:border-[var(--border-strong)] hover:bg-ink-500"
              >
                🎥
              </button>
            ))}
          </div>
        )}
        </>
      ) : (
        <div className="flex flex-col items-start gap-2.5 p-4">
          <div className="text-[12px] leading-relaxed text-t300">
            <span className="text-violet-600">✦</span>&nbsp;{" "}
            {t(
              "Промпта ещё нет. Claude соберёт его из фрагмента сюжета, сущностей и базы знаний.",
              "No prompt yet. Claude will build it from the story fragment, entities and knowledge base.",
            )}
          </div>
          <div className="flex w-full flex-col gap-2">
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[10px] text-t400">{t("Видеомодель:", "Video model:")}</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
              >
                {targetModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[10px] text-t400">{t("ИИ для промпта:", "Prompt AI:")}</span>
              <select
                value={factoryModel}
                onChange={(e) => setFactoryModel(e.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
              >
                {LLM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {en ? m.hintEn : m.hint}
                  </option>
                ))}
                {!LLM_MODELS.some((m) => m.id === factoryModel) && (
                  <option value={factoryModel}>{factoryModel}</option>
                )}
              </select>
            </label>
            <button
              onClick={onGenerate}
              disabled={pending}
              className="min-h-11 w-full rounded-md bg-violet-500 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending
                ? t("Фабрика работает…", "Factory running…")
                : t(
                    `Сгенерировать промпт · ~${fmtUsd(genUsd)}`,
                    `Generate prompt · ~${fmtUsd(genUsd)}`,
                  )}
            </button>
          </div>
          {error && <div className="text-[11px] text-danger">{error}</div>}
        </div>
      )}

      {/* Окно режиссёрского приёма */}
      <Sheet open={Boolean(technique)} onClose={() => setTechnique(null)} title={technique?.title ?? ""}>
        {technique && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {[technique.category, technique.camera, technique.lens, technique.lighting]
                .filter(Boolean)
                .map((m) => (
                  <span
                    key={m}
                    className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300"
                  >
                    {m}
                  </span>
                ))}
            </div>
            {technique.tags && (
              <div className="font-mono text-[10px] text-t400">
                #{technique.tags.split(",").map((t) => t.trim()).join(" #")}
              </div>
            )}
            <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[11px] leading-relaxed text-t200">
              {technique.prompt}
            </div>
            {technique.negative && (
              <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t400">
                negative: {technique.negative}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={t("История версий", "Version history")}>
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
                  {v.feedbackNote === "Ручная правка" ? t("ручная правка", "manual edit") : t("фабрика", "factory")} ·{" "}
                  {new Date(v.createdAt).toLocaleString(t("ru", "en"))}
                </span>
              </div>
              {v.feedbackNote && (
                <div className="mb-1.5 text-[11px] text-t300">«{v.feedbackNote}»</div>
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
