"use client";

/**
 * Шторка «Генерация» (spec §3.1): мультивыбор моделей, бегунок 4–15 с,
 * качество 480/720/1080p (Kling без 480 → авто-720), start-frame из референсов.
 * Стоимость — ТОЧНАЯ от Higgsfield (get_cost, debounce), формула — фолбэк «≈».
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toaster";
import { preflightVideoCredits, startGeneration } from "@/lib/actions/generate";
import { creditsToUsd, fmtUsd } from "@/lib/pricing";
import { promptFamily, type PromptFamily } from "@/lib/llm/models";
import { usePromptTrack } from "@/components/shot/PromptTrackContext";
import { useT } from "@/components/I18nProvider";

export interface CatalogModel {
  id: string;
  name: string;
  credits: number | null;
  qualities: string[];
}

export interface StartFrameOption {
  id: string;
  url: string;
  label: string;
  /** пометка кандидата («раскадровка») — кадр листа именно этой группы */
  badge?: string;
}

// фолбэк-коэффициенты (сверены с живым get_cost 2026-07-12); точные цены — preflight
const QUALITY_COEF: Record<string, number> = { "480p": 0.4, "720p": 1, "1080p": 2 };
const QUALITIES = ["480p", "720p", "1080p"] as const;
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

function estimateFor(model: CatalogModel, durationSec: number, quality: string): number | null {
  if (model.credits == null) return null;
  const q = model.qualities.includes(quality)
    ? quality
    : model.qualities.includes("720p")
      ? "720p"
      : (model.qualities[0] ?? quality);
  return Math.round(model.credits * (durationSec / 5) * (QUALITY_COEF[q] ?? 1));
}

export default function GenerateSheet({
  open,
  onClose,
  shotId,
  promptFamilies,
  models,
  defaultModelIds,
  groupDurationSec,
  aspectRatio,
  defaultStartFrameId,
  latestByFamily,
  versionById,
}: {
  open: boolean;
  onClose: () => void;
  shotId: string;
  /** какие промпт-треки существуют: модели без промпта своего семейства отключены */
  promptFamilies: Record<PromptFamily, boolean>;
  models: CatalogModel[];
  defaultModelIds: string[];
  /** оставлен для совместимости вызова; UI выбора start-frame убран (замечание заказчика) */
  startFrames?: StartFrameOption[];
  groupDurationSec: number;
  aspectRatio: string;
  /** start-frame сцены-продолжения подставляется автоматически, без ручного выбора */
  defaultStartFrameId: string | null;
  /** последняя версия промпта каждого трека — показываем, какая уйдёт на генерацию */
  latestByFamily: Partial<Record<PromptFamily, number>>;
  /** id версии → её номер (для явно открытой/выбранной версии) */
  versionById: Record<string, number>;
}) {
  const t = useT();
  // «открытая» версия активного трека — именно она уйдёт на генерацию (переген
  // одного шота / выбранная старая версия); undefined → последняя версия трека
  const { family, openByFamily } = usePromptTrack();
  const openPromptId = openByFamily[family];
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        defaultModelIds.filter(
          (id) => models.some((m) => m.id === id) && promptFamilies[promptFamily(id)],
        ),
      ),
  );
  const [duration, setDuration] = useState(Math.min(15, Math.max(4, groupDurationSec)));
  // дефолт качества — 480p (Kling его не умеет → авто-720, см. klingFallback)
  const [quality, setQuality] = useState<string>("480p");
  // сериал вертикальный: дефолт 9:16, если из промпта пришёл неизвестный/пустой аспект
  const [aspect, setAspect] = useState<string>(
    (ASPECTS as readonly string[]).includes(aspectRatio) ? aspectRatio : "9:16",
  );
  // битрейт Seedance (Higgsfield): дефолт high (замечание заказчика — раньше уходил
  // standard). Контрол показываем, только если среди выбранных есть Seedance-модель.
  const [bitrate, setBitrate] = useState<"high" | "standard">("high");
  const hasSeedance = [...selected].some((id) => promptFamily(id) === "seedance");
  // start-frame сцены-продолжения подставляется автоматически (spec §3.1); ручного
  // выбора в этой шторке больше нет (замечание заказчика)
  const startFrame = defaultStartFrameId ?? "";
  const [confirmInfo, setConfirmInfo] = useState<{ estimate: number; limit: number } | null>(null);
  const [confirmStep, setConfirmStep] = useState(0); // двухшаговое подтверждение
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // точные цены от Higgsfield (get_cost) по ключу `${duration}:${quality}` → {modelId: credits}
  const [exactByKey, setExactByKey] = useState<Record<string, Record<string, number>>>({});
  const exactKey = `${duration}:${quality}`;
  const exact = exactByKey[exactKey];

  // debounce-запрос точной стоимости при открытии/смене бегунка или качества
  useEffect(() => {
    if (!open || !models.length || exactByKey[exactKey]) return;
    const timer = setTimeout(() => {
      void preflightVideoCredits({
        modelIds: models.map((m) => m.id),
        durationSec: duration,
        aspectRatio: "9:16", // на цену не влияет; фикс, чтобы не дёргать сеть при смене формата
        quality,
      }).then((rows) => {
        const map: Record<string, number> = {};
        for (const r of rows) if (r.exact && r.credits != null) map[r.id] = r.credits;
        if (Object.keys(map).length) {
          setExactByKey((prev) => ({ ...prev, [exactKey]: map }));
        }
      }).catch(() => {});
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exactKey, models.length]);

  /** цена модели: точная от провайдера, иначе формула-фолбэк */
  function priceFor(m: CatalogModel): { value: number | null; isExact: boolean } {
    const ex = exact?.[m.id];
    if (ex != null) return { value: ex, isExact: true };
    return { value: estimateFor(m, duration, quality), isExact: false };
  }

  const { estimate, allExact } = useMemo(() => {
    let sum = 0;
    let allEx = selected.size > 0;
    for (const id of selected) {
      const m = models.find((x) => x.id === id);
      if (!m) continue;
      const ex = exact?.[id];
      if (ex != null) sum += ex;
      else {
        allEx = false;
        sum += estimateFor(m, duration, quality) ?? 0;
      }
    }
    return { estimate: Math.round(sum * 10) / 10, allExact: allEx };
  }, [selected, models, duration, quality, exact]);
  const hasUnknown = [...selected].some(
    (id) => exact?.[id] == null && models.find((m) => m.id === id)?.credits == null,
  );
  const klingFallback =
    quality === "480p" &&
    [...selected].some((id) => !(models.find((m) => m.id === id)?.qualities.includes("480p") ?? false));
  // версия промпта, которая уйдёт на генерацию: явно открытая, иначе последняя трека
  const activeVersion = openPromptId ? versionById[openPromptId] : latestByFamily[family];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmInfo(null);
    setConfirmStep(0);
  }

  function launch() {
    setError("");
    startTransition(async () => {
      // промпт каждой модели сервер подбирает по её семейству (Seedance/Kling)
      const res = await startGeneration({
        shotId,
        // открытая версия активного трека (напр. промпт одного шота); для моделей
        // другого семейства сервер возьмёт их последнюю версию
        promptId: openPromptId || undefined,
        modelIds: [...selected],
        startFrameRefId: startFrame || undefined,
        durationSec: duration,
        aspectRatio: aspect,
        quality,
        // сервер применит битрейт только к Seedance-моделям; для Kling он игнорируется
        bitrate,
        confirmed: confirmStep >= 2,
      });
      if (res.ok) {
        // карточки задач появляются сразу ("в очереди"); отправка провайдеру и
        // подтверждение приёма идут в фоне — статус меняется прямо в карточке
        const n = res.data?.queued ?? selected.size;
        toast(
          t(
            `Поставлено ${n} задач(и) в очередь · статус в карточках`,
            `${n} job(s) queued · status shown on the cards`,
          ),
        );
        setConfirmInfo(null);
        setConfirmStep(0);
        onClose();
      } else if ("needsConfirm" in res && res.needsConfirm) {
        setConfirmInfo({ estimate: res.estimate, limit: res.limit });
        setConfirmStep(1);
      } else if ("error" in res) {
        setError(res.error);
      }
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Генерация · Higgsfield", "Generation · Higgsfield")}>
      <div className="section-label mb-2">{t("Модели (A/B — отметьте несколько)", "Models (A/B — pick several)")}</div>
      <div className="flex flex-col gap-1.5">
        {models.map((m) => {
          const { value: est, isExact } = priceFor(m);
          // у каждой модели свой промпт-трек: без промпта семейства запуск закрыт
          const fam = promptFamily(m.id);
          const hasPrompt = promptFamilies[fam];
          return (
            <label
              key={m.id}
              className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 ${hasPrompt ? "cursor-pointer" : "opacity-50"}`}
              style={{
                borderColor: selected.has(m.id) ? "var(--border-strong)" : "var(--border-subtle)",
                background: selected.has(m.id) ? "var(--ink-600)" : "none",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                disabled={!hasPrompt}
                onChange={() => toggle(m.id)}
                className="h-5 w-5 accent-[var(--violet-400)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[12px] font-semibold text-t100">{m.name}</span>
                <span className="block font-mono text-[9px] text-t400">
                  {hasPrompt
                    ? m.qualities.join(" / ") || "—"
                    : t(
                        `нет промпта ${fam === "kling" ? "Kling" : "Seedance"} — создайте в блоке «Промпт»`,
                        `no ${fam === "kling" ? "Kling" : "Seedance"} prompt — create it in the Prompt block`,
                      )}
                </span>
              </span>
              <span className="text-right font-mono text-[10.5px] text-t300">
                {est != null ? (
                  <>
                    {/* точная цена от Higgsfield — без «≈»; фолбэк-формула — с «≈» */}
                    {isExact ? t(`${est} кр`, `${est} cr`) : t(`≈${est} кр`, `≈${est} cr`)}
                    <span className="block text-[9px] text-t400">~{fmtUsd(creditsToUsd(est))}</span>
                  </>
                ) : (
                  t("кр: ?", "cr: ?")
                )}
              </span>
            </label>
          );
        })}
        {!models.length && (
          <div className="text-[11.5px] text-t400">
            {t(
              "Каталог моделей пуст — обновите его на экране «Затраты и настройки».",
              "The model catalog is empty — refresh it on the Costs screen.",
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-t400">
        <span className="text-success">🎭</span>
        <span>
          {t(
            "Персонажи библии прикрепляются автоматически. Идентичность держат Seedance (Higgsfield) и Kling 3.0 Omni (аккаунт Kling, до 7 референсов; цена — по тарифам Kling, оценки нет).",
            "Bible characters are auto-attached. Identity is locked by Seedance (Higgsfield) and Kling 3.0 Omni (Kling account, up to 7 refs; billed at Kling rates, no preflight estimate).",
          )}
        </span>
      </div>

      <div className="mb-2 mt-4 flex items-baseline gap-2">
        <span className="section-label">{t("Длительность", "Duration")}</span>
        <span className="font-mono text-[12px] font-semibold text-t100">{duration} {t("с", "s")}</span>
        {duration !== groupDurationSec && (
          <span className="text-[9.5px] text-warning">
            {t(`в раскадровке — ${groupDurationSec} с`, `storyboard says ${groupDurationSec} s`)}
          </span>
        )}
      </div>
      <input
        type="range"
        min={4}
        max={15}
        step={1}
        value={duration}
        onChange={(e) => {
          setDuration(Number(e.target.value));
          setConfirmInfo(null);
          setConfirmStep(0);
        }}
        className="w-full accent-[var(--violet-400)]"
      />

      <div className="section-label mb-2 mt-3.5">{t("Качество", "Quality")}</div>
      <div className="flex gap-1.5">
        {QUALITIES.map((q) => (
          <button
            key={q}
            onClick={() => {
              setQuality(q);
              setConfirmInfo(null);
              setConfirmStep(0);
            }}
            className="min-h-10 flex-1 rounded-md border font-mono text-[11.5px] font-semibold"
            style={{
              borderColor: quality === q ? "var(--border-strong)" : "var(--border-subtle)",
              background: quality === q ? "var(--ink-600)" : "none",
              color: quality === q ? "var(--text-100)" : "var(--text-400)",
            }}
          >
            {q}
          </button>
        ))}
      </div>
      {klingFallback && (
        <div className="mt-1.5 text-[10px] text-warning">
          {t("Kling не поддерживает 480p — уйдёт в 720p автоматически.", "Kling has no 480p — it falls back to 720p automatically.")}
        </div>
      )}

      {/* Битрейт — только у Seedance (Higgsfield); высокий = меньше сжатия/крупнее файл */}
      {hasSeedance && (
        <>
          <div className="section-label mb-2 mt-3.5">{t("Битрейт · Seedance", "Bitrate · Seedance")}</div>
          <div className="flex gap-1.5">
            {(
              [
                { id: "high", label: "High", subRu: "меньше сжатия · крупнее файл", subEn: "less compression · larger size" },
                { id: "standard", label: "Standard", subRu: "больше сжатия · меньше файл", subEn: "more compression · smaller size" },
              ] as const
            ).map((b) => (
              <button
                key={b.id}
                onClick={() => setBitrate(b.id)}
                className="flex min-h-11 flex-1 flex-col items-start justify-center gap-0.5 rounded-md border px-2.5 py-1.5 text-left"
                style={{
                  borderColor: bitrate === b.id ? "var(--border-strong)" : "var(--border-subtle)",
                  background: bitrate === b.id ? "var(--ink-600)" : "none",
                }}
              >
                <span
                  className="font-mono text-[11.5px] font-semibold"
                  style={{ color: bitrate === b.id ? "var(--text-100)" : "var(--text-400)" }}
                >
                  {b.id === "high" ? "✨ " : ""}
                  {b.label}
                </span>
                <span className="text-[9px] text-t400">{t(b.subRu, b.subEn)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-label mb-2 mt-3.5">{t("Формат (соотношение сторон)", "Format (aspect ratio)")}</div>
      <div className="flex flex-wrap gap-1.5">
        {ASPECTS.map((a) => (
          <button
            key={a}
            onClick={() => setAspect(a)}
            className="min-h-9 flex-1 rounded-md border px-2 font-mono text-[11px] font-semibold"
            style={{
              borderColor: aspect === a ? "var(--border-strong)" : "var(--border-subtle)",
              background: aspect === a ? "var(--ink-600)" : "none",
              color: aspect === a ? "var(--text-100)" : "var(--text-400)",
            }}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5">
        <span className="text-[11px] text-t300">{t("Оценка списания:", "Estimated charge:")}</span>
        <span className="font-mono text-[10px] text-t400">
          {duration}{t("с", "s")} · {quality} · {aspect}
          {hasSeedance ? ` · ${bitrate === "high" ? "High" : "Std"}` : ""}
        </span>
        <span className="flex-1" />
        <span className="text-right font-mono font-semibold text-t100">
          <span className="text-[13px]">
            {allExact ? "" : "≈ "}
            {estimate}
            {hasUnknown ? "+?" : ""} {t("кр", "cr")}
          </span>
          {estimate > 0 && (
            <span className="block text-[10px] font-normal text-t400">
              ~{fmtUsd(creditsToUsd(estimate))}{hasUnknown ? "+?" : ""}
              {allExact ? t(" · точно", " · exact") : ""}
            </span>
          )}
        </span>
      </div>

      {confirmInfo && (
        <div className="mt-3 rounded-lg border border-[rgba(194,71,106,.5)] bg-[rgba(194,71,106,.1)] px-3 py-2.5 text-[12px] leading-relaxed text-[#e08aa4]">
          {t(
            `≈${confirmInfo.estimate} кр — выше лимита подтверждения (${confirmInfo.limit} кр).`,
            `≈${confirmInfo.estimate} cr — above the confirmation limit (${confirmInfo.limit} cr).`,
          )}
          {confirmStep === 1 ? t(" Нажмите ещё раз, чтобы точно запустить.", " Press again to really launch.") : ""}
        </div>
      )}
      {error && <div className="mt-3 text-[11.5px] text-danger">{error}</div>}

      {/* sticky-футер: кнопка запуска и версия промпта всегда видны, без доскролла */}
      <div
        className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-[var(--border-subtle)] bg-ink-700 px-4 pt-3"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        {activeVersion != null && (
          <div className="mb-2 text-center font-mono text-[10px] text-t400">
            {t("Промпт", "Prompt")} {family === "kling" ? "Kling" : "Seedance"} · v{activeVersion}
          </div>
        )}
        <button
          onClick={() => {
            if (confirmInfo && confirmStep === 1) {
              // второй шаг подтверждения (spec §3.1) — запуск только третьим нажатием
              setConfirmStep(2);
              return;
            }
            launch();
          }}
          disabled={pending || selected.size === 0}
          className="min-h-[52px] w-full rounded-lg text-[12px] font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-50"
          style={{
            background: confirmInfo ? "var(--danger)" : "var(--violet-500)",
            boxShadow: confirmInfo ? "none" : "var(--glow-violet-sm)",
          }}
        >
          {pending
            ? t("Отправка…", "Submitting…")
            : confirmInfo
              ? confirmStep >= 2
                ? t(`Точно запустить · ${confirmInfo.estimate} кр`, `Really launch · ${confirmInfo.estimate} cr`)
                : t(`Подтвердить ${confirmInfo.estimate} кр`, `Confirm ${confirmInfo.estimate} cr`)
              : t(
                  `Запустить ${selected.size} ${selected.size === 1 ? "задачу" : "задачи"}`,
                  `Launch ${selected.size} ${selected.size === 1 ? "job" : "jobs"}`,
                )}
        </button>
      </div>
    </Sheet>
  );
}
