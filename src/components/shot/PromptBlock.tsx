"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import PromptText from "./PromptText";
import { generateShotPromptsFor, latestPromptVersion, deleteTrackPrompts } from "@/lib/actions/prompts";
import { LLM_MODELS, PROMPT_FAMILIES, promptFamily, type PromptFamily } from "@/lib/llm/models";
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
  llmModel,
  usedTechniquesByFamily = { seedance: [], kling: [] },
}: {
  shotId: string;
  episodeId: string;
  versions: PromptVersion[];
  tokens: string[];
  llmModel: string;
  /** приёмы 🎥 текущей версии каждого трека */
  usedTechniquesByFamily?: Record<PromptFamily, UsedTechnique[]>;
}) {
  const router = useRouter();
  const t = useT();
  const en = t("ru", "en") === "en";
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // активный трек: Seedance / Kling (у каждого свой промпт и своя история)
  const [family, setFamily] = useState<PromptFamily>(() =>
    versions[0] ? promptFamily(versions[0].targetModel) : "seedance",
  );
  // что создавать кнопкой: один трек или оба
  const [createChoice, setCreateChoice] = useState<PromptFamily | "both">("seedance");
  // выбор LLM-модели для промпт-фабрики (какая ИИ пишет промпт)
  const [factoryModel, setFactoryModel] = useState(llmModel);
  const [error, setError] = useState("");
  // своя машина состояний вместо useTransition: нужен таймер и поллинг-подхват
  // результата, если ответ долгого запроса потеряется в туннеле
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<{
    tick?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const doneRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [technique, setTechnique] = useState<UsedTechnique | null>(null);
  // удаление промпта трека — двухшаговое (взвод → подтверждение)
  const [armDelete, setArmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackVersions = versions.filter((v) => promptFamily(v.targetModel) === family);
  const current = trackVersions[0] ?? null;
  const hasByFamily: Record<PromptFamily, boolean> = {
    seedance: versions.some((v) => promptFamily(v.targetModel) === "seedance"),
    kling: versions.some((v) => promptFamily(v.targetModel) === "kling"),
  };
  const usedTechniques = usedTechniquesByFamily[family] ?? [];
  const createFamilies: PromptFamily[] =
    createChoice === "both" ? ["seedance", "kling"] : [createChoice];
  // фабрика: ~4К входных токенов (шаблон+библия+приёмы) + типовой вывод; ×2 для обоих треков
  const genUsdOne = estTextUsd(factoryModel, 4000, OUT_TOKENS.prompt);
  const genUsd = genUsdOne == null ? null : genUsdOne * createFamilies.length;

  function openEditor() {
    // редактор открываем на текущей версии активного трека
    router.push(
      `/episodes/${episodeId}/shots/${shotId}/editor${current ? `?v=${current.id}` : ""}`,
    );
  }

  function cleanupTimers() {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.refresh) clearInterval(timers.current.refresh);
    timers.current = {};
  }
  // на размонтирование — гасим таймеры
  useEffect(() => cleanupTimers, []);

  function finishOk() {
    if (doneRef.current) return;
    doneRef.current = true;
    // гасим таймер и поллинг, но НЕ refresh-повторы (их запустим ниже)
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    setGenerating(false);
    // Через туннель одиночный router.refresh() иногда теряется (RSC-ответ дропается),
    // и свежий промпт не появляется до ручного обновления. Повторяем несколько раз —
    // как только обновлённое дерево доедет, промпт отрисуется сам.
    router.refresh();
    let tries = 0;
    const iv = setInterval(() => {
      router.refresh();
      if (++tries >= 4) clearInterval(iv);
    }, 1000);
    timers.current.refresh = iv; // для гашения на размонтирование
  }
  function finishErr(msg: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanupTimers();
    setGenerating(false);
    setError(msg);
  }

  function onGenerate() {
    setError("");
    setElapsed(0);
    setGenerating(true);
    doneRef.current = false;
    const families = createFamilies;
    // версия-ориентир: успех = появилось столько новых версий, сколько треков создаём
    const baseline = versions[0]?.version ?? 0;
    const target = baseline + families.length;
    const started = Date.now();

    // таймер: показываем, что фабрика жива; жёсткий потолок 240 с
    timers.current.tick = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      setElapsed(sec);
      if (sec >= 240) {
        finishErr(
          t(
            "Ответа нет дольше 4 минут. Промпт мог не создаться — попробуйте ещё раз или выберите более быструю модель (Haiku).",
            "No response for over 4 minutes. The prompt may not have been created — try again or pick a faster model (Haiku).",
          ),
        );
      }
    }, 1000);

    // самовосстановление: даже если ответ основного запроса потерялся в туннеле,
    // поллинг увидит сохранённые на сервере версии и подхватит результат
    timers.current.poll = setInterval(async () => {
      try {
        const v = await latestPromptVersion(shotId);
        if (v >= target) finishOk();
      } catch {
        // сеть моргнула — попробуем в следующий тик
      }
    }, 4000);

    // основной запрос: ok → успех; понятная ошибка сервера → показать;
    // обрыв соединения → не падаем, ждём, пока поллинг подхватит результат
    generateShotPromptsFor(shotId, families, factoryModel)
      .then((res) => {
        if (res.ok) {
          setFamily(families[0]); // показать созданный трек
          finishOk();
        } else finishErr(res.error);
      })
      .catch(() => {
        /* соединение потеряно — результат подхватит поллинг */
      });
  }

  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // на размонтирование — гасим таймер взвода
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  async function onDeleteTrack() {
    if (!current) return;
    if (!armDelete) {
      setArmDelete(true);
      armTimer.current = setTimeout(() => setArmDelete(false), 3500);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmDelete(false);
    setDeleting(true);
    await deleteTrackPrompts(shotId, family);
    setDeleting(false);
    setExpanded(false);
    router.refresh(); // промпт трека исчез → появится форма «Сгенерировать»
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
            <button
              onClick={onDeleteTrack}
              disabled={deleting}
              title={t(
                `Удалить промпт ${family === "kling" ? "Kling" : "Seedance"} и сгенерировать заново`,
                `Delete the ${family === "kling" ? "Kling" : "Seedance"} prompt to regenerate`,
              )}
              className="flex h-7 items-center justify-center rounded-md px-1.5 text-[12px] disabled:opacity-50"
              style={{
                color: armDelete ? "var(--danger)" : "var(--text-300)",
                background: armDelete ? "rgba(194,71,106,.12)" : "none",
              }}
            >
              {deleting ? "…" : armDelete ? t("удалить?", "delete?") : "🗑"}
            </button>
          </>
        )}
      </div>

      {/* треки промптов: у Seedance и Kling разная структура — промпты раздельные */}
      <div className="flex gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
        {PROMPT_FAMILIES.map((f) => {
          const active = family === f.id;
          const exists = hasByFamily[f.id];
          return (
            <button
              key={f.id}
              onClick={() => {
                setFamily(f.id);
                setCreateChoice(f.id);
                setExpanded(false);
                setArmDelete(false);
              }}
              className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold"
              style={{
                borderColor: active ? "var(--border-strong)" : "transparent",
                background: active ? "var(--ink-600)" : "none",
                color: active ? "var(--text-100)" : "var(--text-400)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.icon} alt="" className="h-4 w-4 rounded-[3px]" />
              {f.label}
              {!exists && (
                <span className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-t400">
                  {t("нет", "none")}
                </span>
              )}
            </button>
          );
        })}
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
              `Промпта для ${family === "kling" ? "Kling" : "Seedance"} ещё нет. Claude соберёт его по шаблону этого трека из фрагмента сюжета, сущностей и базы знаний.`,
              `No ${family === "kling" ? "Kling" : "Seedance"} prompt yet. Claude will build it from this track's template, the story fragment, entities and knowledge base.`,
            )}
          </div>
          <div className="flex w-full flex-col gap-2">
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[10px] text-t400">{t("Создать для:", "Create for:")}</span>
              <select
                value={createChoice}
                onChange={(e) => setCreateChoice(e.target.value as PromptFamily | "both")}
                disabled={generating}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none disabled:opacity-60"
              >
                <option value="seedance">Seedance</option>
                <option value="kling">Kling</option>
                <option value="both">Seedance & Kling ({t("2 промпта", "2 prompts")})</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[10px] text-t400">{t("ИИ для промпта:", "Prompt AI:")}</span>
              <select
                value={factoryModel}
                onChange={(e) => setFactoryModel(e.target.value)}
                disabled={generating}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none disabled:opacity-60"
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
            <div className="text-[9.5px] leading-snug text-t400">
              {t(
                "Haiku — самый быстрый (~10–20 с), Opus — умнее, но думает дольше (до 1–2 мин).",
                "Haiku is fastest (~10–20 s), Opus is smarter but slower (up to 1–2 min).",
              )}
            </div>
            <button
              onClick={onGenerate}
              disabled={generating}
              className="min-h-11 w-full rounded-md bg-violet-500 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {generating
                ? t(`Фабрика работает… ${elapsed}с`, `Factory running… ${elapsed}s`)
                : t(
                    `Сгенерировать промпт · ~${fmtUsd(genUsd)}`,
                    `Generate prompt · ~${fmtUsd(genUsd)}`,
                  )}
            </button>
          </div>
          {generating && (
            <div className="text-[10px] leading-snug text-t400">
              {t(
                "Идёт генерация. Можно не ждать на экране — промпт сохранится даже при обрыве связи и подхватится сам.",
                "Generating. You don't have to wait here — the prompt is saved even if the connection drops and will be picked up automatically.",
              )}
            </div>
          )}
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
          {trackVersions.map((v) => (
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
