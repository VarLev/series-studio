"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateEpisode,
  breakdownEpisode,
  saveBreakdown,
  saveLlmModelChoice,
} from "@/lib/actions/episodes";
import type { Breakdown } from "@/lib/llm/contracts";
import { LLM_MODELS } from "@/lib/llm/models";
import { estTextUsd, estTokens, OUT_TOKENS, fmtUsd } from "@/lib/pricing";
import BreakdownPreview from "./BreakdownPreview";
import DualRange from "@/components/DualRange";
import { SectionLabel } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

// границы бегунка хронометража эпизода (минуты) и дефолт 3–5
const DUR_MIN = 1;
const DUR_MAX = 15;
const DUR_DEFAULT: [number, number] = [3, 5];

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
      className="min-h-9 w-full min-w-0 max-w-full truncate rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
      title="LLM model"
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
  breakdownModel,
  onBreakdownModelChange,
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shotsCount: number;
  shotTitles?: string[];
  breakdownModel: string;
  onBreakdownModelChange: (m: string) => void;
}) {
  const router = useRouter();
  const t = useT();
  const draftKey = `ss-draft:${episodeId}`;
  // раскадровка стоит реальных денег — предпросмотр переживает переключение
  // вкладок и перезагрузку страницы через localStorage (замечание заказчика)
  const bdKey = `ss-bd:${episodeId}`;
  // хронометраж эпизода задаётся бегунком; переживает вкладки/перезагрузку (per-episode)
  const durKey = `ss-dur:${episodeId}`;
  const [title, setTitle] = useState(initialTitle);
  const [logline, setLogline] = useState(initialLogline);
  const [synopsis, setSynopsis] = useState(initialSynopsis);
  const [durMin, setDurMin] = useState(DUR_DEFAULT[0]);
  const [durMax, setDurMax] = useState(DUR_DEFAULT[1]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [breakingDown, setBreakingDown] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // счётчик секунд, пока Claude раскадрирует — чтобы ожидание не выглядело зависанием
  useEffect(() => {
    if (!breakingDown) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [breakingDown]);

  function pickModel(model: string) {
    onBreakdownModelChange(model);
    void saveLlmModelChoice(model); // сразу в настройки — переживает перезагрузку
  }

  function setDuration(lo: number, hi: number) {
    setDurMin(lo);
    setDurMax(hi);
    try {
      localStorage.setItem(durKey, JSON.stringify([lo, hi]));
    } catch {}
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
        // предпросмотры старого формата ({shots:[…]}) молча пропускаем
        if (Array.isArray(bd?.groups) && bd.groups.length) setPreview(bd);
      }
      const rawDur = localStorage.getItem(durKey);
      if (rawDur) {
        const [lo, hi] = JSON.parse(rawDur);
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          setDurMin(lo);
          setDurMax(hi);
        }
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

  async function onBreakdown() {
    setElapsed(0);
    setBreakingDown(true);
    setError("");
    const res = await breakdownEpisode(episodeId, breakdownModel, { min: durMin, max: durMax });
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
            "Логлайн — одна фраза о серии",
            "Logline — one sentence about the episode",
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
          "Вставьте сюда готовый литературный сюжет серии — Claude разобьёт его на группы шотов по шаблону из настроек.",
          "Paste the finished literary story of the episode here — Claude will break it into shot groups per your Settings template.",
        )}
        className="min-h-[40dvh] flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 font-body text-[15px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
      />

      {error && <div className="text-[12px] text-danger">{error}</div>}

      {synopsis.trim() && (
        <div className="flex flex-col gap-2 pb-4">
          <div className="text-[11px] leading-relaxed text-t400">
            <span className="text-violet-600">✦</span>&nbsp;{" "}
            {t(
              "Claude разобьёт сюжет по шаблону из настроек: группы шотов ≤ 15 сек, внутри — шоты с таймингом, персонажи подтянутся из библии.",
              "Claude breaks the story per the Settings template: shot groups ≤ 15 sec with timed shots inside; characters are linked from the bible.",
            )}
          </div>
          {/* двойной бегунок: диапазон хронометража эпизода (мин), применяется к промпту разбивки */}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-t400">
                {t("Хронометраж эпизода:", "Episode duration:")}
              </span>
              <span className="font-mono text-[12px] font-semibold text-t100">
                {durMin === durMax
                  ? `${durMin} ${t("мин", "min")}`
                  : `${durMin}–${durMax} ${t("мин", "min")}`}
              </span>
            </div>
            <DualRange
              min={DUR_MIN}
              max={DUR_MAX}
              low={durMin}
              high={durMax}
              onChange={setDuration}
            />
            <div className="flex justify-between font-mono text-[9px] text-t400">
              <span>{DUR_MIN} {t("мин", "min")}</span>
              <span>{DUR_MAX} {t("мин", "min")}</span>
            </div>
          </div>

          {/* label над селектом + w-full: длинные подписи моделей не вылезают за карточку */}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] text-t400">{t("Модель раскадровки:", "Breakdown model:")}</span>
            <ModelSelect
              value={breakdownModel}
              onChange={pickModel}
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
              ? t(`Claude раскадрирует… ${elapsed}с`, `Claude is storyboarding… ${elapsed}s`)
              : (() => {
                  const usd = fmtUsd(
                    estTextUsd(breakdownModel, estTokens(synopsis) + 1500, OUT_TOKENS.breakdown),
                  );
                  return shotsCount > 0
                    ? t(
                        `Раскадровать (готовые не дублируются) · ~${usd}`,
                        `Break down (existing kept) · ~${usd}`,
                      )
                    : t(`Разбить на группы шотов · ~${usd}`, `Break into shot groups · ~${usd}`);
                })()}
          </button>
        </div>
      )}
    </div>
  );
}
