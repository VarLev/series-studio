"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import PromptText from "./PromptText";
import {
  generateShotPromptsFor,
  latestPromptVersion,
  deletePromptVersion,
  listPromptVersions,
} from "@/lib/actions/prompts";
import {
  LLM_MODELS,
  PROMPT_FAMILIES,
  promptFamily,
  isClaudeModel,
  isGptModel,
  type PromptFamily,
} from "@/lib/llm/models";
import { estTextUsd, OUT_TOKENS, fmtUsd } from "@/lib/pricing";
import { usePromptTrack } from "@/components/shot/PromptTrackContext";
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

type ResumeMarker = { families: PromptFamily[]; baseline: number; startedAt: number };

/**
 * Маркер незавершённой генерации промпта из localStorage; протухший (старше 4 мин,
 * как таймаут фабрики) удаляем. Только для клиента — зовётся из эффекта.
 */
function readResumeMarker(key: string): ResumeMarker | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const m = JSON.parse(raw) as { families?: PromptFamily[]; baseline?: number; startedAt?: number };
    if (!m?.startedAt || !m.families?.length) return null;
    if (Date.now() - m.startedAt > 240_000) {
      localStorage.removeItem(key);
      return null;
    }
    return { families: m.families, baseline: m.baseline ?? 0, startedAt: m.startedAt };
  } catch {
    return null;
  }
}

export default function PromptBlock({
  shotId,
  episodeId,
  versions,
  versionCountByFamily,
  tokens,
  tokenImages = {},
  llmModel,
  usedTechniquesByFamily = { seedance: [], kling: [] },
  useCli = false,
  useCliGpt = false,
}: {
  shotId: string;
  episodeId: string;
  /** последние ~10 версий + текущие каждого трека (остальные — по «показать ещё») */
  versions: PromptVersion[];
  /** полное число версий каждого трека — для кнопки «показать ещё» */
  versionCountByFamily: Record<PromptFamily, number>;
  tokens: string[];
  /** токен → url миниатюры (тап по токену в тексте промпта раскрывает её) */
  tokenImages?: Record<string, string | null>;
  llmModel: string;
  /** приёмы 🎥 текущей версии каждого трека */
  usedTechniquesByFamily?: Record<PromptFamily, UsedTechnique[]>;
  /** llm_use_cli на /costs — Claude-вызовы идут через подписку, не по цене API */
  useCli?: boolean;
  /** llm_use_cli_gpt на /costs — GPT-вызовы идут через подписку ChatGPT (Codex CLI) */
  useCliGpt?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const en = t("ru", "en") === "en";
  // маркер незавершённой генерации в localStorage: переживает уход со страницы и
  // возврат/ремаунт. Читается ПОСЛЕ маунта (эффект возобновления ниже) — см. там
  const genKey = `pgen:${shotId}`;
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // активный трек и «открытая» версия — из общего контекста (его же читают
  // GroupShotsEditor для иконки-генерации и ActionBar для отправки на генерацию)
  const { family, setFamily, openByFamily, setOpen } = usePromptTrack();
  // что создавать кнопкой: один трек или оба
  const [createChoice, setCreateChoice] = useState<PromptFamily | "both">("seedance");
  // выбор LLM-модели для промпт-фабрики (какая ИИ пишет промпт). По умолчанию —
  // глобальная модель промптов (settings.llm_model) как есть, включая GPT
  // (GPT идёт через Codex CLI). Можно переключить прямо здесь.
  const [factoryModel, setFactoryModel] = useState(llmModel);
  const [error, setError] = useState("");
  // своя машина состояний вместо useTransition: нужен таймер и поллинг-подхват
  // результата, если ответ долгого запроса потеряется в туннеле. Стартуем всегда с
  // «не генерируется» — как в SSR-разметке; возобновление поднимет флаг после маунта.
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<{
    tick?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const doneRef = useRef(false);
  const [copied, setCopied] = useState(false);
  // точка нажатия на тексте промпта — по ней отличаем тап от протаскивания
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const [technique, setTechnique] = useState<UsedTechnique | null>(null);
  // удаление промпта трека — двухшаговое (взвод → подтверждение)
  const [armDelete, setArmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // полные списки версий трека, подгруженные по «показать ещё»: на клиент по
  // умолчанию уезжают только последние ~10 (экономия пейлоада через туннель)
  const [loadedExtra, setLoadedExtra] = useState<Partial<Record<PromptFamily, PromptVersion[]>>>({});
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMoreVersions() {
    setLoadingMore(true);
    try {
      const all = await listPromptVersions(shotId, family);
      setLoadedExtra((m) => ({ ...m, [family]: all }));
    } catch {
      // сеть моргнула — кнопка «показать ещё» останется
    } finally {
      setLoadingMore(false);
    }
  }

  // версии активного трека: полный список, если подгружен, иначе присланные последние
  const trackVersions = loadedExtra[family] ?? versions.filter((v) => promptFamily(v.targetModel) === family);
  // «открытая» версия трека: выбранная в контексте, иначе последняя. На генерацию
  // уходит именно она (см. ActionBar/GenerateSheet).
  const openId = openByFamily[family];
  const current =
    (openId ? trackVersions.find((v) => v.id === openId) : null) ?? trackVersions[0] ?? null;
  const hasByFamily: Record<PromptFamily, boolean> = {
    seedance: versionCountByFamily.seedance > 0,
    kling: versionCountByFamily.kling > 0,
  };
  // сколько версий трека ещё не загружено (кнопка «показать ещё» в истории)
  const moreToLoad = loadedExtra[family] ? 0 : versionCountByFamily[family] - trackVersions.length;
  const usedTechniques = usedTechniquesByFamily[family] ?? [];
  const createFamilies: PromptFamily[] =
    createChoice === "both" ? ["seedance", "kling"] : [createChoice];
  // у выбранного трека промпт уже есть → кнопка добавит НОВУЮ версию (не первую)
  const targetHasPrompt = createFamilies.some((f) => hasByFamily[f]);
  // фабрика: ~4К входных токенов (шаблон+библия+приёмы) + типовой вывод; ×2 для обоих треков
  const genUsdOne = estTextUsd(factoryModel, 4000, OUT_TOKENS.prompt);
  const genUsd = genUsdOne == null ? null : genUsdOne * createFamilies.length;
  // при включённом CLI вызов идёт через подписку — цена в $ не расходуется
  // (Claude → Claude Code CLI, GPT → Codex CLI)
  const genCost =
    (useCli && isClaudeModel(factoryModel)) || (useCliGpt && isGptModel(factoryModel))
      ? "(CLI)"
      : `~${fmtUsd(genUsd)}`;

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

  function clearMarker() {
    try {
      localStorage.removeItem(genKey);
    } catch {}
  }

  function finishOk() {
    if (doneRef.current) return;
    doneRef.current = true;
    clearMarker();
    // новая версия трека стала последней — открываем её (сбрасываем ручной выбор)
    setOpen(family, undefined);
    // подгруженный по «показать ещё» полный список устарел: без сброса он перекрывал
    // бы свежий проп versions, и новая версия не показалась бы (а на генерацию
    // ушла бы старая). После сброса список снова строится из versions с сервера.
    setLoadedExtra({});
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
    clearMarker();
    cleanupTimers();
    setGenerating(false);
    setError(msg);
  }

  // Слежение за генерацией: таймер «фабрика жива» + поллинг сохранённой версии
  // (самовосстановление, если ответ основного запроса потерялся в туннеле).
  // Вынесено, чтобы возобновлять слежение при возврате на страницу.
  function startWatch(count: number, baseline: number, startedAt: number) {
    doneRef.current = false;
    const target = baseline + count;
    timers.current.tick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
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
    timers.current.poll = setInterval(async () => {
      try {
        const v = await latestPromptVersion(shotId);
        if (v >= target) finishOk();
      } catch {
        // сеть моргнула — попробуем в следующий тик
      }
    }, 4000);
  }

  function onGenerate() {
    setError("");
    setElapsed(0);
    const families = createFamilies;
    // версия-ориентир: успех = появилось столько новых версий, сколько треков создаём
    const baseline = versions[0]?.version ?? 0;
    const startedAt = Date.now();
    try {
      localStorage.setItem(genKey, JSON.stringify({ families, baseline, startedAt }));
    } catch {}
    setGenerating(true);
    startWatch(families.length, baseline, startedAt);

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

  // Возврат на страницу во время генерации: подхватываем маркер и возобновляем
  // слежение. localStorage читаем ЗДЕСЬ, после гидратации, а не ленивым
  // инициализатором useState: на сервере его нет, поэтому маркер правил первым
  // клиентским рендером (generating, elapsed) и расходился с SSR-разметкой —
  // перезагрузка во время генерации ломала гидратацию.
  //
  /* eslint-disable react-hooks/set-state-in-effect -- разовая синхронизация с
     ВНЕШНИМ хранилищем (localStorage) после маунта: каскада нет (deps пустые,
     эффект отрабатывает один раз), а альтернатива — читать маркер в инициализаторе
     useState — и есть тот самый баг гидратации, который мы здесь чиним. */
  useEffect(() => {
    const m = readResumeMarker(genKey);
    if (!m) return cleanupTimers;
    setGenerating(true);
    setElapsed(Math.floor((Date.now() - m.startedAt) / 1000));
    startWatch(m.families.length, m.baseline, m.startedAt);
    return cleanupTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Тап по тексту раскрывает/сворачивает промпт. Но ВЫДЕЛЕНИЕ текста тоже
   * заканчивается кликом на этом блоке — и промпт схлопывался ровно в тот момент,
   * когда его выделяли, чтобы скопировать. Тап от выделения отличаем по трём
   * признакам: протащили мышь/палец, есть выделение, это второй клик двойного.
   */
  function onTextClick(e: React.MouseEvent) {
    const start = pressAt.current;
    pressAt.current = null;
    if (e.detail > 1) return; // второй клик двойного — его откатит onDoubleClick
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    setExpanded((v) => !v);
  }

  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // на размонтирование — гасим таймер взвода
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  async function onDeleteVersion() {
    if (!current) return;
    if (!armDelete) {
      setArmDelete(true);
      armTimer.current = setTimeout(() => setArmDelete(false), 3500);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmDelete(false);
    setDeleting(true);
    await deletePromptVersion(current.id); // удаляем ТОЛЬКО открытую версию
    setDeleting(false);
    setExpanded(false);
    setOpen(family, undefined); // открытой станет последняя из оставшихся версий
    setLoadedExtra({}); // полный список устарел (см. finishOk) — перечитаем из versions
    router.refresh(); // если версий больше нет — появится форма «Сгенерировать»
  }

  return (
    // shrink-0 обязателен: колонка страницы шота на десктопе — flex фиксированной
    // высоты (lg:h-dvh), а flex-ребёнок с overflow-hidden получает min-height:0 и
    // при переполнении сжимается В НОЛЬ — блок «исчезал» со страницы (инцидент)
    <div className="shrink-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-700">
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
              onClick={onDeleteVersion}
              disabled={deleting}
              title={t(
                `Удалить открытую версию v${current.version} (остальные версии останутся)`,
                `Delete the open version v${current.version} (other versions stay)`,
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

      {current && (
        <>
        {/* клик по тексту — раскрыть/свернуть (не открывать редактор; правка по ✎),
            но только если это тап, а не выделение — см. onTextClick */}
        <div
          onPointerDown={(e) => {
            pressAt.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={onTextClick}
          // двойной клик выделяет слово: первый клик двойного успел свернуть блок —
          // возвращаем как было, выделение при этом остаётся
          onDoubleClick={() => setExpanded((v) => !v)}
          // курсор честный: свёрнутый блок — кнопка «раскрыть», раскрытый — текст
          className={`block w-full text-left ${expanded ? "cursor-text" : "cursor-pointer"}`}
        >
          <div
            className="relative overflow-hidden transition-[max-height]"
            style={{ maxHeight: expanded ? "4000px" : "108px" }}
          >
            <div className="whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-[1.7] text-t200">
              <PromptText text={current.text} tokens={tokens} images={tokenImages} />
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
      )}

      {/* Генерация промпта доступна ВСЕГДА: если промпт уже есть — добавит новую
          версию выбранного трека, старые версии сохраняются (видны в истории v). */}
      <div
        className={`flex flex-col items-start gap-2.5 p-4${
          current ? " border-t border-[var(--border-subtle)]" : ""
        }`}
      >
        {current ? (
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
            {t("Новая версия промпта", "New prompt version")}
          </div>
        ) : (
          <div className="text-[12px] leading-relaxed text-t300">
            <span className="text-violet-600">✦</span>&nbsp;{" "}
            {t(
              `Промпта для ${family === "kling" ? "Kling" : "Seedance"} ещё нет. Claude соберёт его по шаблону этого трека из фрагмента сюжета, сущностей и базы знаний.`,
              `No ${family === "kling" ? "Kling" : "Seedance"} prompt yet. Claude will build it from this track's template, the story fragment, entities and knowledge base.`,
            )}
          </div>
        )}
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
              : targetHasPrompt
                ? t(`Новая версия промпта · ${genCost}`, `New prompt version · ${genCost}`)
                : t(`Сгенерировать промпт · ${genCost}`, `Generate prompt · ${genCost}`)}
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

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title={t("Версии промпта", "Prompt versions")}>
        <div className="mb-2 text-[10.5px] leading-relaxed text-t400">
          {t(
            "«Открыть» делает версию текущей — именно она уйдёт на генерацию. Версии не удаляются.",
            "“Open” makes a version current — it's the one sent to generation. Versions are never deleted.",
          )}
        </div>
        <div className="flex flex-col gap-2.5 pb-2">
          {trackVersions.map((v) => {
            const isOpen = current?.id === v.id;
            const kindLabel =
              v.feedbackNote === "Ручная правка"
                ? t("ручная правка", "manual edit")
                : v.feedbackNote?.startsWith("Только шот")
                  ? t("один шот", "single shot")
                  : t("фабрика", "factory");
            return (
              <div
                key={v.id}
                className="rounded-lg border p-3"
                style={{
                  borderColor: isOpen ? "var(--border-strong)" : "var(--border-subtle)",
                  background: isOpen ? "var(--ink-600)" : "var(--ink-800)",
                }}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-magenta-400">v{v.version}</span>
                  {isOpen && (
                    <span className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200">
                      {t("открыт", "open")}
                    </span>
                  )}
                  <span className="font-mono text-[9.5px] text-chrome-mid">{v.targetModel}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-t400">
                    {kindLabel} · {new Date(v.createdAt).toLocaleString(t("ru", "en"))}
                  </span>
                </div>
                {v.feedbackNote && <div className="mb-1.5 text-[11px] text-t300">«{v.feedbackNote}»</div>}
                <div className="line-clamp-4 whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-t400">
                  {v.text}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      // undefined, если это последняя версия — чтобы не «залипать» на id
                      setOpen(family, v.id === trackVersions[0]?.id ? undefined : v.id);
                      setHistoryOpen(false);
                    }}
                    disabled={isOpen}
                    className="flex-1 rounded-md bg-violet-500 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-violet-400 disabled:opacity-40"
                  >
                    {isOpen ? t("Открыт", "Open") : t("Открыть эту версию", "Open this version")}
                  </button>
                  <button
                    onClick={() => router.push(`/episodes/${episodeId}/shots/${shotId}/editor?v=${v.id}`)}
                    title={t("Править в редакторе", "Edit in editor")}
                    className="rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-t200 hover:bg-ink-500"
                  >
                    ✎
                  </button>
                </div>
              </div>
            );
          })}
          {moreToLoad > 0 && (
            <button
              onClick={loadMoreVersions}
              disabled={loadingMore}
              className="min-h-9 rounded-lg border border-[var(--border-subtle)] text-[10px] font-semibold uppercase tracking-[0.08em] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200 disabled:opacity-50"
            >
              {loadingMore
                ? t("Загрузка…", "Loading…")
                : t(`Показать ещё ${moreToLoad}`, `Show ${moreToLoad} more`)}
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
