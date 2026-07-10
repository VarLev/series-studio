"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateEpisode, generateSynopsis, breakdownEpisode, saveBreakdown } from "@/lib/actions/episodes";
import type { Breakdown } from "@/lib/llm/contracts";
import BreakdownPreview from "./BreakdownPreview";
import { SectionLabel } from "@/components/ui";

type SaveState = "saved" | "saving" | "local" | "idle";

export default function SynopsisEditor({
  episodeId,
  initialTitle,
  initialLogline,
  initialSynopsis,
  shotsCount,
  shotTitles = [],
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shotsCount: number;
  shotTitles?: string[];
}) {
  const router = useRouter();
  const draftKey = `ss-draft:${episodeId}`;
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
    const res = await generateSynopsis(episodeId, brief);
    setGenerating(false);
    if (res.ok) {
      setSynopsis(res.synopsis);
      setSaveState("saved");
    } else setError(res.error);
  }

  async function onBreakdown() {
    setBreakingDown(true);
    setError("");
    const res = await breakdownEpisode(episodeId);
    setBreakingDown(false);
    if (res.ok) setPreview(res.breakdown);
    else setError(res.error);
  }

  async function onConfirmBreakdown(confirmed: Breakdown, mode: "append" | "replace") {
    await saveBreakdown(episodeId, confirmed, mode);
    setPreview(null);
    router.refresh();
  }

  const saveLabel =
    saveState === "saving"
      ? "сохранение…"
      : saveState === "saved"
        ? "сохранено"
        : saveState === "local"
          ? "черновик сохранён локально"
          : "";

  if (preview) {
    return (
      <BreakdownPreview
        breakdown={preview}
        existingTitles={shotTitles}
        onCancel={() => setPreview(null)}
        onConfirm={onConfirmBreakdown}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Название серии"
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
        <input
          value={logline}
          onChange={(e) => onChange({ logline: e.target.value })}
          placeholder="Логлайн — одна фраза о серии (попадает в контекст следующих серий)"
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <SectionLabel right={<span className="font-mono text-[10px] text-t400">{saveLabel}</span>}>
        Литературный сюжет
      </SectionLabel>

      <textarea
        value={synopsis}
        onChange={(e) => onChange({ synopsis: e.target.value })}
        spellCheck={false}
        placeholder="Опишите серию как рассказ — Claude раскадрирует его на группы шотов до 15 секунд."
        className="min-h-[40dvh] flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 font-body text-[15px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
      />

      {error && <div className="text-[12px] text-danger">{error}</div>}

      {!synopsis.trim() && (
        <div className="flex flex-col gap-2">
          <input
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Задание для Claude: что должно случиться в этой серии?"
            className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <button
            onClick={onGenerate}
            disabled={generating}
            className="min-h-[52px] w-full rounded-lg bg-violet-500 px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {generating ? "Claude пишет сюжет…" : "Сгенерировать сюжет"}
          </button>
        </div>
      )}

      {synopsis.trim() && (
        <div className="flex flex-col gap-2 pb-4">
          <div className="text-[11px] leading-relaxed text-t400">
            <span className="text-violet-600">✦</span>&nbsp; Claude прочитает сюжет, разобьёт его
            на группы шотов ≤ 15 сек и сам определит сущности в каждой.
          </div>
          <button
            onClick={onBreakdown}
            disabled={breakingDown}
            className="min-h-[52px] w-full rounded-lg bg-violet-500 px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {breakingDown
              ? "Claude раскадрирует…"
              : shotsCount > 0
                ? "Раскадровать (готовые группы не дублируются)"
                : "Разбить на шоты"}
          </button>
        </div>
      )}
    </div>
  );
}
