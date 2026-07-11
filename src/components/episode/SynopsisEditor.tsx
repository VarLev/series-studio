"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateEpisode,
  generateSynopsis,
  breakdownEpisode,
  saveBreakdown,
  saveLlmModelChoice,
} from "@/lib/actions/episodes";
import type { Breakdown } from "@/lib/llm/contracts";
import { LLM_MODELS } from "@/lib/llm/models";
import BreakdownPreview from "./BreakdownPreview";
import { SectionLabel } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

type SaveState = "saved" | "saving" | "local" | "idle";

function ModelSelect({
  value,
  onChange,
  en,
}: {
  value: string;
  onChange: (v: string) => void;
  en: boolean;
}) {
  const known = LLM_MODELS.some((m) => m.id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-9 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
      title="Claude model"
    >
      {LLM_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} — {en ? m.hintEn : m.hint}
        </option>
      ))}
      {!known && <option value={value}>{value}</option>}
    </select>
  );
}

export default function SynopsisEditor({
  episodeId,
  initialTitle,
  initialLogline,
  initialSynopsis,
  shotsCount,
  shotTitles = [],
  synopsisModel,
  breakdownModel,
  onSynopsisModelChange,
  onBreakdownModelChange,
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shotsCount: number;
  shotTitles?: string[];
  synopsisModel: string;
  breakdownModel: string;
  onSynopsisModelChange: (m: string) => void;
  onBreakdownModelChange: (m: string) => void;
}) {
  const router = useRouter();
  const t = useT();
  const draftKey = `ss-draft:${episodeId}`;
  // раскадровка стоит реальных денег — предпросмотр переживает переключение
  // вкладок и перезагрузку страницы через localStorage (замечание заказчика)
  const bdKey = `ss-bd:${episodeId}`;
  const [title, setTitle] = useState(initialTitle);
  const [logline, setLogline] = useState(initialLogline);
  const [synopsis, setSynopsis] = useState(initialSynopsis);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [breakingDown, setBreakingDown] = useState(false);
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pickModel(kind: "synopsis" | "breakdown", model: string) {
    (kind === "synopsis" ? onSynopsisModelChange : onBreakdownModelChange)(model);
    void saveLlmModelChoice(kind, model); // сразу в настройки — переживает перезагрузку
  }

  function stashPreview(b: Breakdown | null) {
    setPreview(b);
    try {
      if (b) localStorage.setItem(bdKey, JSON.stringify(b));
      else localStorage.removeItem(bdKey);
    } catch {}
  }

  // restore local draft if it is newer than what the server rendered;
  // localStorage существует только в браузере, поэтому восстановление — в эффекте
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.synopsis && draft.synopsis !== initialSynopsis) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSynopsis(draft.synopsis);
          setSaveState("local");
        }
        if (draft.title && draft.title !== initialTitle) setTitle(draft.title);
        if (draft.logline && draft.logline !== initialLogline) setLogline(draft.logline);
      }
      const rawBd = localStorage.getItem(bdKey);
      if (rawBd) {
        const bd = JSON.parse(rawBd) as Breakdown;
        if (Array.isArray(bd?.shots) && bd.shots.length) setPreview(bd);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = useCallback(
    (next: { title: string; logline: string; synopsis: string }) => {
      // черновик не теряется при обрыве сети: сначала localStorage, потом сервер
      try {
        localStorage.setItem(draftKey, JSON.stringify(next));
      } catch {}
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await updateEpisode(episodeId, {
            title: next.title,
            logline: next.logline,
            synopsisMd: next.synopsis,
          });
          try {
            localStorage.removeItem(draftKey);
          } catch {}
          setSaveState("saved");
        } catch {
          setSaveState("local");
        }
      }, 900);
    },
    [draftKey, episodeId],
  );

  function onChange(patch: Partial<{ title: string; logline: string; synopsis: string }>) {
    const next = { title, logline, synopsis, ...patch };
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.logline !== undefined) setLogline(patch.logline);
    if (patch.synopsis !== undefined) setSynopsis(patch.synopsis);
    scheduleSave(next);
  }

  async function onGenerate() {
    setGenerating(true);
    setError("");
    const res = await generateSynopsis(episodeId, brief, synopsisModel);
    setGenerating(false);
    if (res.ok) {
      setSynopsis(res.synopsis);
      setSaveState("saved");
    } else setError(res.error);
  }

  async function onBreakdown() {
    setBreakingDown(true);
    setError("");
    const res = await breakdownEpisode(episodeId, breakdownModel);
    setBreakingDown(false);
    if (res.ok) stashPreview(res.breakdown);
    else setError(res.error);
  }

  async function onConfirmBreakdown(confirmed: Breakdown, mode: "append" | "replace") {
    await saveBreakdown(episodeId, confirmed, mode);
    stashPreview(null);
    router.refresh();
  }

  const saveLabel =
    saveState === "saving"
      ? t("сохранение…", "saving…")
      : saveState === "saved"
        ? t("сохранено", "saved")
        : saveState === "local"
          ? t("черновик сохранён локально", "draft saved locally")
          : "";

  if (preview) {
    return (
      <BreakdownPreview
        breakdown={preview}
        existingTitles={shotTitles}
        onCancel={() => stashPreview(null)}
        onConfirm={onConfirmBreakdown}
        onEdited={(b) => {
          // правки в предпросмотре тоже не должны теряться при переключении вкладок
          try {
            localStorage.setItem(bdKey, JSON.stringify(b));
          } catch {}
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t("Название серии", "Episode title")}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
        <input
          value={logline}
          onChange={(e) => onChange({ logline: e.target.value })}
          placeholder={t(
            "Логлайн — одна фраза о серии (попадает в контекст следующих серий)",
            "Logline — one sentence about the episode (feeds the next episodes' context)",
          )}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <SectionLabel right={<span className="font-mono text-[10px] text-t400">{saveLabel}</span>}>
        {t("Литературный сюжет", "Literary story")}
      </SectionLabel>

      <textarea
        value={synopsis}
        onChange={(e) => onChange({ synopsis: e.target.value })}
        spellCheck={false}
        placeholder={t(
          "Опишите серию как рассказ — Claude раскадрирует его на группы шотов до 15 секунд.",
          "Describe the episode as a story — Claude will break it into shot groups of up to 15 seconds.",
        )}
        className="min-h-[40dvh] flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 font-body text-[15px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
      />

      {error && <div className="text-[12px] text-danger">{error}</div>}

      {!synopsis.trim() && (
        <div className="flex flex-col gap-2">
          <input
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t(
              "Задание для Claude: что должно случиться в этой серии?",
              "Brief for Claude: what should happen in this episode?",
            )}
            className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-t400">{t("Модель сюжета:", "Story model:")}</span>
            <ModelSelect
              value={synopsisModel}
              onChange={(m) => pickModel("synopsis", m)}
              en={t("ru", "en") === "en"}
            />
          </div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="min-h-[52px] w-full rounded-lg bg-violet-500 px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {generating
              ? t("Claude пишет сюжет…", "Claude is writing the story…")
              : t("Сгенерировать сюжет", "Generate story")}
          </button>
        </div>
      )}

      {synopsis.trim() && (
        <div className="flex flex-col gap-2 pb-4">
          <div className="text-[11px] leading-relaxed text-t400">
            <span className="text-violet-600">✦</span>&nbsp;{" "}
            {t(
              "Claude прочитает сюжет, разобьёт его на группы шотов ≤ 15 сек и сам определит сущности в каждой.",
              "Claude reads the story, breaks it into shot groups of ≤ 15 sec and detects the entities in each.",
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-t400">{t("Модель раскадровки:", "Breakdown model:")}</span>
            <ModelSelect
              value={breakdownModel}
              onChange={(m) => pickModel("breakdown", m)}
              en={t("ru", "en") === "en"}
            />
          </div>
          <button
            onClick={onBreakdown}
            disabled={breakingDown}
            className="min-h-[52px] w-full rounded-lg bg-violet-500 px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {breakingDown
              ? t("Claude раскадрирует…", "Claude is storyboarding…")
              : shotsCount > 0
                ? t("Раскадровать (готовые группы не дублируются)", "Break down (existing groups are kept)")
                : t("Разбить на шоты", "Break into shots")}
          </button>
        </div>
      )}
    </div>
  );
}
