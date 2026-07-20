"use client";

/**
 * Шоты группы: карточки статичные (правка поля — по ✎). Замечание к группе
 * уходит в Claude. НОВОЕ: карточку можно «взять» долгим нажатием и перетащить в
 * блок Rework — тогда правка применится ТОЛЬКО к добавленным шотам; если не
 * добавлен ни один — Claude сам решает, каких шотов касается замечание.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateGroupBeats,
  unpinReferenceFromBeat,
  reviseGroup,
  groupBeatsStamp,
  updateGroupLocation,
  updateGroupTimeWeather,
  updateGroupEmotionalTone,
} from "@/lib/actions/shots";
import { generateSingleShotPrompt, latestPromptVersion } from "@/lib/actions/prompts";
import type { GroupShot } from "@/lib/llm/contracts";
import { PROMPT_FAMILIES } from "@/lib/llm/models";
import { usePromptTrack } from "@/components/shot/PromptTrackContext";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import Sheet from "@/components/Sheet";

/** Компактная карточка приёма из библиотеки — для пикера ручного закрепления. */
export interface TechniqueOption {
  id: string;
  title: string;
  category: string;
  camera: string;
  tags: string;
}

/** Миниатюра референса группы — для бейджей закреплённых за шотами (beats[].ref_ids). */
export interface RefThumb {
  id: string;
  url: string;
  role: string;
  /** якорь в промпте (@Comp1..N); у start-frame пуст в этом контексте */
  anchor: string;
}

const fieldCls =
  "w-full rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 outline-none focus:border-[var(--border-strong)]";

// чтение часов через модульный хелпер: react-hooks/purity не трассирует его как
// impure (в отличие от прямого Date.now()), а таймстамп старта реворка нужен в
// обработчике клика — это легитимный побочный доступ, не render
const nowMs = (): number => Date.now();

// Клиентский потолок ожидания реворка. Серверный реворк в ХУДШЕМ случае — это две
// попытки runJson (ретрай при невалидном JSON первого ответа) × (LLM_TIMEOUT_MS 180с
// + 30с холодного старта CLI) = ~420с модельного времени, плюс сохранение/нормализация/
// пересчёт таймкодов. Потолок ДОЛЖЕН быть заведомо больше: иначе UI объявляет провал и
// сносит поллинг+маркер, пока сервер ещё дописывает результат — шоты применяются и ответ
// модели виден в Console, а пользователь видит «нет ответа» (инцидент 2026-07-14). Тем же
// значением ограничена свежесть маркера в localStorage (иначе они разъедутся).
const REV_CEILING_MS = 480_000; // 8 минут — с запасом над серверным худшим случаем (~7 мин)

const MIN_BEAT_SEC = 1;
const MAX_GROUP_SEC = 15;
const TIME_RE = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/;

// свайп влево по карточке шота переносит его между Main/Draft (замечание заказчика):
// SWIPE_ARM — порог, после которого жест распознаётся как горизонтальный (а не
// скролл/долгое нажатие); SWIPE_TRIGGER — сдвиг влево, после которого перенос срабатывает
const SWIPE_ARM = 14;
const SWIPE_TRIGGER = 56;

/**
 * Строки диалога для отображения. Реплики нескольких персонажей приходят в
 * формате «[Имя]: -фраза» построчно (см. шаблоны разбивки/enhance/rework) —
 * разбиваем по переводам строк, пустые отбрасываем. Старый формат (одна строка
 * без переносов) возвращается как единственная строка — обратная совместимость.
 */
function dialogueLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// та же логика, что parseTimeRange/fmtTime в lib/beats.ts — дублируем локально
// (не тянем @/lib/beats в клиентский бандл: там же серверный @/lib/db)
function beatSeconds(b: GroupShot): number {
  const m = b.time.match(TIME_RE);
  if (!m) return 2;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return end > start ? end - start : 2;
}
function fmtBeatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
/**
 * Нормализация структуры (клиентское зеркало normalizeBeats из lib/beats.ts):
 * основные шоты (Main) — order 1..N, время подряд от 00:00; черновые (Draft) —
 * своя шкала от 00:00, order после основных. Результат всегда упорядочен
 * [main..., drafts...] — глобальные индексы карточек стабильны для областей.
 * durations — переопределение длительностей по глобальным индексам list.
 */
function renormalize(list: GroupShot[], durations?: number[]): GroupShot[] {
  const ds = durations ?? list.map(beatSeconds);
  const out: GroupShot[] = [];
  let order = 1;
  for (const draftArea of [false, true]) {
    let cursor = 0;
    list.forEach((b, i) => {
      if (Boolean(b.draft) !== draftArea) return;
      const d = ds[i];
      out.push({ ...b, order: order++, time: `${fmtBeatTime(cursor)}–${fmtBeatTime(cursor + d)}` });
      cursor += d;
    });
  }
  return out;
}

/** Сумма секунд ОСНОВНЫХ шотов (лимит 15 сек касается только их). */
function mainSeconds(list: GroupShot[]): number {
  return list.filter((b) => !b.draft).reduce((a, b) => a + beatSeconds(b), 0);
}

interface DragState {
  order: number;
  x: number;
  y: number;
  over: boolean;
}

/**
 * Спойлер параметров группы (локация/погода/тон): закрытый — одна строка
 * «иконка · лейбл · значение…» (обрезка до …), открытый — полная панель.
 * Точка у шеврона предупреждает о несохранённой правке в закрытом виде.
 */
function CollapsePanel({
  icon,
  label,
  summary,
  emptyText,
  dirty,
  children,
}: {
  icon: string;
  label: string;
  summary: string;
  emptyText: string;
  dirty: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full items-center gap-2 px-2.5 text-left"
      >
        <span className="shrink-0 text-[11px] leading-none">{icon}</span>
        <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
          {label}
        </span>
        {!open && (
          <span
            className={`min-w-0 flex-1 truncate text-[11.5px] ${summary.trim() ? "text-t200" : "text-t400"}`}
          >
            {summary.trim() || emptyText}
          </span>
        )}
        {open && <span className="flex-1" />}
        {dirty && !open && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
        <span className="shrink-0 text-[10px] text-t400">{open ? "▴" : "▾"}</span>
      </button>
      {open && <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

export default function GroupShotsEditor({
  shotId,
  initialBeats,
  llmModel,
  location = "",
  timeWeather = "",
  emotionalTone = "",
  techniqueLibrary = [],
  refThumbs = [],
  topSlot,
}: {
  shotId: string;
  initialBeats: GroupShot[];
  /** ИИ для промпт-фабрики (та же, что в блоке промпта) — генерит промпт одного шота */
  llmModel?: string;
  /** локация сюжетной связки (одна до следующего «начала сцены») */
  location?: string;
  /** время суток и погода сюжетной связки (тоже одни на сцену) */
  timeWeather?: string;
  /** эмоциональный тон группы — свой у каждой группы (не единый на сцену) */
  emotionalTone?: string;
  /** библиотека приёмов для ручного закрепления за шотом (пикер) */
  techniqueLibrary?: TechniqueOption[];
  /** миниатюры референсов группы — бейджи закреплённых за шотами (beats[].ref_ids) */
  refThumbs?: RefThumb[];
  /** секции, встающие сразу после эмоционального тона (Сущности + Референсы) */
  topSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const t = useT();
  // Rework всегда через Claude по подписке (см. llmReviseGroup) — цены нет
  const reviseCost = "(CLI)";
  const [beats, setBeats] = useState<GroupShot[]>(initialBeats);
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  // счётчик неудачных авто-повторов сохранения — двигает deps эффекта-ретрая
  const [retry, setRetry] = useState(0);
  const [feedback, setFeedback] = useState("");
  // маркер идущего реворка — переживает уход со страницы и ремаунт (как pgen в
  // PromptBlock): на возврате поллинг возобновляется и результат долетает
  const grevKey = `grev:${shotId}`;
  const [revMarker] = useState<{ stamp: string; startedAt: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(grevKey);
      if (!raw) return null;
      const m = JSON.parse(raw) as { stamp?: string; startedAt?: number };
      if (!m?.startedAt || !m.stamp) return null;
      if (Date.now() - m.startedAt > REV_CEILING_MS) {
        localStorage.removeItem(grevKey);
        return null;
      }
      return { stamp: m.stamp, startedAt: m.startedAt };
    } catch {
      return null;
    }
  });
  const revStartRef = useRef<number>(revMarker ? revMarker.startedAt : 0);
  const [revising, setRevising] = useState(Boolean(revMarker));
  const [elapsed, setElapsed] = useState(() =>
    revMarker ? Math.floor((Date.now() - revMarker.startedAt) / 1000) : 0,
  );
  const [error, setError] = useState("");
  const [saving, startSave] = useTransition();
  // спойлер «Draft Shots»: ВСЕГДА свёрнут по умолчанию (замечание заказчика).
  // Раскрывается только явным действием — тап по шапке, «+ Черновик», перенос сюда.
  const [draftsOpen, setDraftsOpen] = useState(false);
  // пикер ручного закрепления приёма: индекс шота (в массиве beats) + поиск
  const [pickBeat, setPickBeat] = useState<number | null>(null);
  const [pickQuery, setPickQuery] = useState("");
  const techById = new Map(techniqueLibrary.map((tq) => [tq.id, tq]));
  // миниатюры референсов по id — резолв beats[].ref_ids в бейджи; висячие id не рендерятся
  const refThumbById = new Map(refThumbs.map((r) => [r.id, r]));

  // локация связки: правка на любой группе обновляет все группы сцены
  const [loc, setLoc] = useState(location);
  const [savingLoc, startSaveLoc] = useTransition();
  const [prevLocation, setPrevLocation] = useState(location);
  if (prevLocation !== location) {
    setPrevLocation(location);
    setLoc(location);
  }
  const locDirty = loc.trim() !== location.trim();

  // время суток и погода связки: правка на любой группе обновляет все группы сцены
  const [tw, setTw] = useState(timeWeather);
  const [savingTw, startSaveTw] = useTransition();
  const [prevTw, setPrevTw] = useState(timeWeather);
  if (prevTw !== timeWeather) {
    setPrevTw(timeWeather);
    setTw(timeWeather);
  }
  const twDirty = tw.trim() !== timeWeather.trim();
  // быстрые чипы: клик добавляет термин к полю (через запятую)
  const TW_PRESETS = [
    { ru: "день", en: "day" },
    { ru: "вечер", en: "evening" },
    { ru: "ночь", en: "night" },
    { ru: "рассвет", en: "dawn" },
    { ru: "солнечно", en: "sunny" },
    { ru: "пасмурно", en: "overcast" },
    { ru: "дождь", en: "rain" },
    { ru: "туман", en: "fog" },
    { ru: "снег", en: "snow" },
  ];
  function addTwPreset(term: string) {
    setTw((prev) => {
      const cur = prev.trim();
      if (cur.toLowerCase().split(/[,\s]+/).includes(term)) return prev; // уже есть
      return cur ? `${cur}, ${term}` : term;
    });
  }

  // эмоциональный тон группы: СВОЙ у группы (не на связку) — правка меняет только её
  const [tone, setTone] = useState(emotionalTone);
  const [savingTone, startSaveTone] = useTransition();
  const [prevTone, setPrevTone] = useState(emotionalTone);
  if (prevTone !== emotionalTone) {
    setPrevTone(emotionalTone);
    setTone(emotionalTone);
  }
  const toneDirty = tone.trim() !== emotionalTone.trim();
  // быстрые чипы тона (значение в поле — на английском, уходит в промпт)
  const TONE_PRESETS = [
    { ru: "спокойный", en: "calm" },
    { ru: "нежный", en: "tender" },
    { ru: "тёплый", en: "warm" },
    { ru: "радостный", en: "joyful" },
    { ru: "напряжённый", en: "tense" },
    { ru: "тревожный", en: "anxious" },
    { ru: "зловещий", en: "ominous" },
    { ru: "грустный", en: "melancholic" },
    { ru: "злой", en: "angry" },
  ];
  function addTonePreset(term: string) {
    setTone((prev) => {
      const cur = prev.trim();
      if (cur.toLowerCase().split(/[,\s]+/).includes(term)) return prev; // уже есть
      return cur ? `${cur}, ${term}` : term;
    });
  }

  // активный трек (Seedance/Kling) + иконка — из общего контекста карточки шота
  const { family, setOpen } = usePromptTrack();
  const famMeta = PROMPT_FAMILIES.find((f) => f.id === family) ?? PROMPT_FAMILIES[0];
  const [genBeat, setGenBeat] = useState<number | null>(null);
  // самовосстановление ⚡: долгий CLI-вызов может потерять ответ в туннеле —
  // тогда промпт в базе создан, но одиночный router.refresh() не доезжает и он
  // не появляется до ручной перезагрузки. Поэтому параллельно поллим номер
  // последней версии промпта и, как только он вырос, обновляем страницу (burst).
  const genTimers = useRef<{
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const genDone = useRef(false);
  useEffect(
    () => () => {
      if (genTimers.current.poll) clearInterval(genTimers.current.poll);
      if (genTimers.current.refresh) clearInterval(genTimers.current.refresh);
    },
    [],
  );
  async function onGenShot(order: number) {
    setGenBeat(order);
    genDone.current = false;
    // ориентир: успех = номер последней версии промпта вырос
    let baseline = 0;
    try {
      baseline = await latestPromptVersion(shotId);
    } catch {
      // не сняли ориентир — подхватим по возврату основного запроса
    }
    let ticks = 0; // каждый тик поллинга = 4с; 60 тиков ≈ 240с — потолок ожидания

    const finishOk = (promptId?: string) => {
      if (genDone.current) return;
      genDone.current = true;
      if (genTimers.current.poll) clearInterval(genTimers.current.poll);
      setGenBeat(null);
      if (promptId) setOpen(family, promptId); // открытой станет новая версия
      toast(
        t(
          `Промпт шота ${order} создан (${famMeta.label}) — открыт`,
          `Shot ${order} prompt created (${famMeta.label}) — opened`,
        ),
      );
      // через туннель одиночный refresh теряется — повторяем несколько раз
      router.refresh();
      let n = 0;
      genTimers.current.refresh = setInterval(() => {
        router.refresh();
        if (++n >= 4 && genTimers.current.refresh) clearInterval(genTimers.current.refresh);
      }, 1000);
    };
    const finishErr = (msg: string) => {
      if (genDone.current) return;
      genDone.current = true;
      if (genTimers.current.poll) clearInterval(genTimers.current.poll);
      setGenBeat(null);
      toast(msg);
    };

    genTimers.current.poll = setInterval(async () => {
      if (++ticks > 60) {
        finishErr(
          t(
            "Ответа нет дольше 4 минут — промпт мог не создаться, попробуйте ещё раз.",
            "No response for over 4 minutes — the prompt may not have been created, try again.",
          ),
        );
        return;
      }
      try {
        const v = await latestPromptVersion(shotId);
        if (v > baseline) finishOk();
      } catch {
        // сеть моргнула — попробуем в следующий тик
      }
    }, 4000);

    try {
      const res = await generateSingleShotPrompt(shotId, family, order, llmModel);
      if (res.ok) finishOk(res.promptId);
      else finishErr(res.error);
    } catch {
      // соединение потеряно (туннель) — результат подхватит поллинг
    }
  }

  // шоты, добавленные в Rework (правка ограничивается ими); порядок добавления
  const [reworkOrders, setReworkOrders] = useState<number[]>([]);
  // спойлер Rework: свёрнут по умолчанию (замечание заказчика). Во время
  // перетаскивания раскрывается сам — иначе шот некуда бросить (drop-зона внутри).
  const [reworkOpen, setReworkOpen] = useState(false);
  // перетаскивание: ghost под пальцем + подсветка drop-зоны
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragActive = useRef(false); // синхронный флаг (без гонок со стейтом)
  const dropRef = useRef<HTMLDivElement>(null);
  const lp = useRef<
    { timer?: ReturnType<typeof setTimeout>; order: number; x: number; y: number; pointerId: number; el: HTMLElement } | null
  >(null);
  // свайп влево по карточке (перенос Main↔Draft, #1): dx для сдвига карточки под
  // пальцем; swiping — синхронный флаг активного свайпа (как dragActive)
  const [swipe, setSwipe] = useState<{ order: number; dx: number } | null>(null);
  const swiping = useRef(false);
  // раскрытые в полную высоту карточки шотов (#6): свёрнутые показывают по одной
  // строке с обрезкой …, тап по карточке раскрывает/сворачивает. Ключ — order шота.
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  function toggleExpand(order: number) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  }
  // перенос шота в противоположную область по свайпу влево (Main↔Draft). Все
  // проверки (последний основной, лимит 15с) и автосейв — внутри moveBeat.
  function swipeToOtherArea(order: number) {
    const b = beats.find((x) => x.order === order);
    if (!b) return;
    moveBeat(order, b.draft ? "main" : "draft", null);
  }

  // после reviseGroup сервер отдаёт новые шоты — принимаем их, если нет своих
  // правок И нет открытой карточки. Иначе периодический router.refresh (GenPoller
  // каждые 6с, пока есть активные задачи) захлопывал открытый на редактирование
  // шот через пару секунд (инцидент). Открытый редактор = «занят», не клобберим.
  const [prevInitial, setPrevInitial] = useState(initialBeats);
  if (prevInitial !== initialBeats) {
    setPrevInitial(initialBeats);
    if (!dirty && editing.size === 0) {
      setBeats(initialBeats);
      setReworkOrders([]);
    }
  }

  useEffect(() => {
    if (!revising) return;
    // отсчёт от реального старта (revStartRef) — на ремаунте не сбрасывается в ноль
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - revStartRef.current) / 1000)),
      500,
    );
    return () => clearInterval(id);
  }, [revising]);

  useEffect(() => () => { if (lp.current?.timer) clearTimeout(lp.current.timer); }, []);

  // единая точка сохранения шотов группы (закрытие карточки ✓, перенос, правка приёма).
  // Кнопка «Сохранить шоты» убрана (замечание заказчика) — вместо неё автосейв на
  // каждое действие + тихое самовосстановление ниже (эффект по dirty), чтобы правки
  // не терялись при обрыве туннеля уже без ручной кнопки.
  async function persistNow(next: GroupShot[], silent = false): Promise<boolean> {
    try {
      await updateGroupBeats(shotId, next);
      setDirty(false);
      setRetry(0); // связь вернулась — следующий сбой снова начинает с короткой паузы
      if (!silent) toast(t("Шоты сохранены", "Shots saved"));
      return true;
    } catch (err) {
      console.error("beats save failed:", err);
      setDirty(true); // осталось локально — подхватит авто-повтор ниже
      if (!silent)
        toast(
          t(
            "Не сохранилось (сеть?) — повторю автоматически",
            "Save failed (network?) — retrying automatically",
          ),
        );
      return false;
    }
  }
  function persist(next: GroupShot[] = beats) {
    startSave(async () => {
      await persistNow(next);
    });
  }

  // Самовосстановление автосейва вместо кнопки «Сохранить шоты»: если правки
  // остались несохранёнными (обрыв туннеля) и ни одна карточка не открыта на
  // редактирование — тихо повторяем сохранение, пока не пройдёт.
  //
  // retry в deps обязателен: провал зовёт setDirty(true), но dirty уже true —
  // состояние не меняется, deps те же, эффект не перезапускается. Без счётчика
  // «повторяем, пока не пройдёт» повторяло ровно ОДИН раз. Пауза растёт до 40 с,
  // чтобы наглухо отвергнутое сохранение не долбило сервер каждые 2.5 с.
  useEffect(() => {
    if (!dirty || editing.size > 0 || saving) return;
    const delay = Math.min(2500 * 2 ** Math.min(retry, 4), 40_000);
    const id = setTimeout(async () => {
      if (!(await persistNow(beats, true))) setRetry((n) => n + 1);
    }, delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, editing, saving, beats, retry]);

  function toggleEdit(i: number) {
    const closing = editing.has(i); // ✓ на открытой карточке = «готово»
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    // раньше ✓ только сворачивал редактор, а сохранение висело на отдельной
    // кнопке снизу — правка терялась после обновления страницы. Теперь закрытие
    // карточки сразу пишет её в базу.
    if (closing) persist();
  }

  function patch(i: number, p: Partial<GroupShot>) {
    setBeats(beats.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
    setDirty(true);
  }

  // длительность шота — в секундах; диапазоны пересчитываются сразу (программно,
  // без ИИ). Лимит 15 сек действует ТОЛЬКО на основные шоты — черновики свободны
  function setBeatDuration(i: number, seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const durations = beats.map(beatSeconds);
    durations[i] = Math.max(MIN_BEAT_SEC, Math.round(seconds));
    if (!beats[i].draft) {
      const mainTotal = beats.reduce((a, b, idx) => a + (b.draft ? 0 : durations[idx]), 0);
      if (mainTotal > MAX_GROUP_SEC) {
        toast(
          t(
            `Основные шоты не могут быть длиннее ${MAX_GROUP_SEC} секунд (вышло бы ${mainTotal})`,
            `Main shots can't exceed ${MAX_GROUP_SEC} seconds (would be ${mainTotal})`,
          ),
        );
        return;
      }
    }
    setBeats(renormalize(beats, durations));
    setDirty(true);
  }

  function newBeat(draft: boolean): GroupShot {
    return { order: 0, time: "", framing: "", camera: "", action: "", dialogue: "", technique_id: "", ref_ids: [], draft, locked: false };
  }

  function addBeat() {
    if (mainSeconds(beats) + 2 > MAX_GROUP_SEC) {
      toast(
        t(
          `Нельзя добавить шот — основные шоты не могут быть длиннее ${MAX_GROUP_SEC} секунд. Добавьте черновик.`,
          `Can't add a shot — main shots can't exceed ${MAX_GROUP_SEC} seconds. Add a draft instead.`,
        ),
      );
      return;
    }
    // новый основной — в конец области Main (перед черновиками)
    const mainCount = beats.filter((b) => !b.draft).length;
    const next = [...beats];
    next.splice(mainCount, 0, newBeat(false));
    setBeats(renormalize(next));
    setEditing(new Set([mainCount]));
    setDirty(true);
  }

  // черновой шот: без лимита длительности, в промпт и тайминг группы не входит
  function addDraft() {
    const next = [...beats, newBeat(true)];
    setBeats(renormalize(next));
    setEditing(new Set([next.length - 1]));
    setDraftsOpen(true); // спойлер мог быть свёрнут — раскрываем, чтобы был виден
    setDirty(true);
  }

  function removeBeat(i: number) {
    // нельзя опустошить область Main; черновики удаляются свободно
    if (!beats[i].draft && beats.filter((b) => !b.draft).length <= 1) return;
    const remaining = beats.filter((_, idx) => idx !== i);
    setBeats(renormalize(remaining));
    setEditing(new Set());
    setDirty(true);
  }

  // замок шота (🔒): защищает шот от Enhance — вернётся дословно, без разбиения и
  // переписывания. Тайминг не меняется, ренормализация не нужна; сразу сохраняем
  function toggleLock(i: number) {
    const next = beats.map((b, idx) => (idx === i ? { ...b, locked: !b.locked } : b));
    setBeats(next);
    startSave(async () => {
      try {
        await updateGroupBeats(shotId, next);
        toast(
          next[i].locked
            ? t("Шот заблокирован — Enhance вернёт его без изменений", "Shot locked — Enhance returns it unchanged")
            : t("Замок снят", "Shot unlocked"),
        );
      } catch (err) {
        console.error("toggle lock failed:", err);
        setDirty(true); // осталось локально — подхватит авто-повтор
        toast(
          t(
            "Не сохранилось (сеть?) — повторю автоматически",
            "Save failed (network?) — retrying automatically",
          ),
        );
      }
    });
  }

  // снять закреплённый приём с шота (не нравится подбор Enhance): чистим
  // technique_id и сразу сохраняем — тайминг не меняется, ренормализация не нужна
  function removeTechnique(i: number) {
    if (!beats[i]?.technique_id) return;
    const next = beats.map((b, idx) => (idx === i ? { ...b, technique_id: "" } : b));
    setBeats(next);
    startSave(async () => {
      try {
        await updateGroupBeats(shotId, next);
        toast(t("Приём снят с шота", "Technique removed"));
      } catch (err) {
        console.error("remove technique failed:", err);
        setDirty(true); // осталось локально — подхватит авто-повтор
        toast(
          t(
            "Не сохранилось (сеть?) — повторю автоматически",
            "Save failed (network?) — retrying automatically",
          ),
        );
      }
    });
  }

  // открепить референс от шота (✕ на бейдже-миниатюре): серверный экшен чистит
  // ref_ids И синхронизирует строки-директивы промпта; локальный стейт обновляем
  // сразу. Тайминг не меняется — как removeTechnique, без ренормализации.
  function unpinRefFromBeat(i: number, refId: string) {
    if (!(beats[i]?.ref_ids ?? []).includes(refId)) return;
    const order = beats[i].order;
    const next = beats.map((b, idx) =>
      idx === i ? { ...b, ref_ids: (b.ref_ids ?? []).filter((id) => id !== refId) } : b,
    );
    setBeats(next);
    startSave(async () => {
      try {
        await unpinReferenceFromBeat(shotId, order, refId);
        toast(t("Референс откреплён от шота", "Reference unpinned from the shot"));
      } catch (err) {
        console.error("unpin ref failed:", err);
        setDirty(true); // осталось локально — подхватит авто-повтор
        toast(
          t(
            "Не сохранилось (сеть?) — повторю автоматически",
            "Save failed (network?) — retrying automatically",
          ),
        );
      }
    });
  }

  // закрепить приём за шотом руками (пикер): пишем technique_id и сразу сохраняем.
  // Тайминг не меняется — как и removeTechnique, без ренормализации.
  function setTechniqueFor(i: number, id: string) {
    setPickBeat(null);
    setPickQuery("");
    if (beats[i]?.technique_id === id) return;
    const next = beats.map((b, idx) => (idx === i ? { ...b, technique_id: id } : b));
    setBeats(next);
    startSave(async () => {
      try {
        await updateGroupBeats(shotId, next);
        toast(t("Приём закреплён за шотом", "Technique attached"));
      } catch (err) {
        console.error("attach technique failed:", err);
        setDirty(true); // осталось локально — подхватит авто-повтор
        toast(
          t(
            "Не сохранилось (сеть?) — повторю автоматически",
            "Save failed (network?) — retrying automatically",
          ),
        );
      }
    });
  }

  /**
   * Перенос/переупорядочивание шота (drag&drop): между областями Main/Draft и
   * внутри области. beforeIdx — глобальный индекс вставки (null → в конец
   * области). После переноса — автосохранение: серверный список Main должен
   * сразу соответствовать экрану (промпт-фабрика читает его из БД).
   */
  function moveBeat(fromOrder: number, area: "main" | "draft", beforeIdx: number | null) {
    const fromIdx = beats.findIndex((b) => b.order === fromOrder);
    if (fromIdx === -1) return;
    const wasDraft = Boolean(beats[fromIdx].draft);
    const toDraft = area === "draft";
    // последний основной нельзя увести в черновики — группа без Main не живёт
    if (!wasDraft && toDraft && beats.filter((b) => !b.draft).length <= 1) {
      toast(t("Нельзя убрать последний основной шот", "Can't move the last main shot away"));
      return;
    }
    const item = { ...beats[fromIdx], draft: toDraft };
    const rest = beats.filter((_, idx) => idx !== fromIdx);
    let insertAt: number;
    if (beforeIdx == null) {
      insertAt = area === "main" ? rest.filter((b) => !b.draft).length : rest.length;
    } else {
      insertAt = beforeIdx > fromIdx ? beforeIdx - 1 : beforeIdx;
    }
    // самодроп (зажал и отпустил на месте): ничего не меняется — НЕ сохраняем,
    // иначе каждое случайное отпускание гоняло бы автосейв по сети
    if (insertAt === fromIdx && wasDraft === toDraft) return;
    rest.splice(insertAt, 0, item);
    const next = renormalize(rest);
    // перенос черновика в Main не должен пробить лимит 15 сек
    if (wasDraft && !toDraft && mainSeconds(next) > MAX_GROUP_SEC) {
      toast(
        t(
          `Не помещается: основные шоты стали бы длиннее ${MAX_GROUP_SEC} секунд — сперва освободите место`,
          `Doesn't fit: main shots would exceed ${MAX_GROUP_SEC} seconds — free up room first`,
        ),
      );
      return;
    }
    setBeats(next);
    setEditing(new Set());
    setExpandedCards(new Set()); // order шотов переназначились — сбрасываем раскрытие
    if (toDraft) setDraftsOpen(true); // перенос в черновики — раскрываем спойлер
    startSave(async () => {
      // reject внутри транзиции уронил бы страницу в error boundary — ловим сами
      try {
        await updateGroupBeats(shotId, next);
        setDirty(false);
        toast(t("Перенесено · сохранено", "Moved · saved"));
      } catch (err) {
        console.error("beat move autosave failed:", err);
        setDirty(true); // изменение осталось локально — подхватит авто-повтор
        toast(
          t(
            "Перенос не сохранился (сеть?) — повторю автоматически",
            "Move not saved (network?) — retrying automatically",
          ),
        );
      }
    });
  }

  // ---------- Drag & drop шотов в Rework ----------
  function isOverDrop(x: number, y: number): boolean {
    const r = dropRef.current?.getBoundingClientRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  }
  function addRework(order: number) {
    // реворк оперирует только основными шотами (сервер черновики игнорирует)
    if (beats.find((b) => b.order === order)?.draft) {
      toast(
        t(
          "Черновики не участвуют в реворке — сперва перенесите шот в Main",
          "Drafts don't join rework — move the shot to Main first",
        ),
      );
      return;
    }
    setReworkOrders((prev) => (prev.includes(order) ? prev : [...prev, order]));
    setReworkOpen(true); // добавили шот — раскрываем, чтобы виден был чип и замечание
  }
  function removeRework(order: number) {
    setReworkOrders((prev) => prev.filter((o) => o !== order));
  }

  function onCardPointerDown(e: React.PointerEvent<HTMLDivElement>, order: number, isEditing: boolean) {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest("button, input, textarea")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    lp.current = { order, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el };
    lp.current.timer = setTimeout(() => {
      if (!lp.current) return;
      dragActive.current = true;
      try { el.setPointerCapture(lp.current.pointerId); } catch {}
      // снять выделение, которое браузер мог начать за время долгого нажатия
      if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
      setDrag({ order, x: lp.current.x, y: lp.current.y, over: isOverDrop(lp.current.x, lp.current.y) });
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    }, 300);
  }
  function onCardPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragActive.current) {
      const x = e.clientX, y = e.clientY;
      setDrag((d) => (d ? { ...d, x, y, over: isOverDrop(x, y) } : d));
      return;
    }
    // активный свайп влево — двигаем карточку под пальцем (только влево)
    if (swiping.current && lp.current) {
      setSwipe({ order: lp.current.order, dx: Math.min(0, e.clientX - lp.current.x) });
      return;
    }
    if (lp.current) {
      const dx = e.clientX - lp.current.x;
      const dy = e.clientY - lp.current.y;
      // горизонталь доминирует → свайп переноса Main↔Draft (не скролл, не долгое нажатие)
      if (Math.abs(dx) >= SWIPE_ARM && Math.abs(dx) > Math.abs(dy)) {
        if (lp.current.timer) clearTimeout(lp.current.timer);
        swiping.current = true;
        try { lp.current.el.setPointerCapture(lp.current.pointerId); } catch {}
        if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
        setSwipe({ order: lp.current.order, dx: Math.min(0, dx) });
        return;
      }
      // вертикаль → это скролл, отменяем захват (долгое нажатие не сработает)
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        if (lp.current.timer) clearTimeout(lp.current.timer);
        lp.current = null;
      }
    }
  }
  /** Куда бросили: карточка (вставка до/после неё) или пустая зона области. */
  function dropTargetAt(x: number, y: number): { area: "main" | "draft"; beforeIdx: number | null } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const card = el.closest<HTMLElement>("[data-beat-idx]");
    if (card) {
      const idx = Number(card.dataset.beatIdx);
      if (!Number.isFinite(idx) || !beats[idx]) return null;
      const r = card.getBoundingClientRect();
      const after = y > r.top + r.height / 2;
      return { area: beats[idx].draft ? "draft" : "main", beforeIdx: after ? idx + 1 : idx };
    }
    const areaEl = el.closest<HTMLElement>("[data-beat-area]");
    if (areaEl) return { area: areaEl.dataset.beatArea as "main" | "draft", beforeIdx: null };
    return null;
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, drop: boolean) {
    if (lp.current?.timer) clearTimeout(lp.current.timer);
    if (dragActive.current) {
      // жест НИКОГДА не должен ронять экран: любое исключение — в toast (это и
      // защита, и диагностика: текст ошибки виден без консоли браузера)
      try {
        if (drop && drag) {
          if (isOverDrop(e.clientX, e.clientY)) {
            addRework(drag.order);
          } else {
            // дроп на карточку/область → перенос или переупорядочивание
            const target = dropTargetAt(e.clientX, e.clientY);
            if (target) moveBeat(drag.order, target.area, target.beforeIdx);
          }
        }
      } catch (err) {
        console.error("beat dnd failed:", err);
        toast(`DnD: ${err instanceof Error ? err.message : String(err)}`);
      }
      try { lp.current?.el.releasePointerCapture(e.pointerId); } catch {}
      dragActive.current = false;
      setDrag(null);
    }
    lp.current = null;
  }

  // pointerup по карточке: завершение свайпа (перенос области), либо drag-drop,
  // либо — быстрый тап без смещения — раскрытие/сворачивание карточки (#6)
  function onCardPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (swiping.current) {
      const order = lp.current?.order;
      const dx = e.clientX - (lp.current?.x ?? e.clientX);
      try { lp.current?.el.releasePointerCapture(e.pointerId); } catch {}
      if (lp.current?.timer) clearTimeout(lp.current.timer);
      swiping.current = false;
      setSwipe(null);
      lp.current = null;
      if (order != null && dx <= -SWIPE_TRIGGER) {
        try {
          swipeToOtherArea(order);
        } catch (err) {
          console.error("beat swipe move failed:", err);
          toast(`Swipe: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }
    if (dragActive.current) {
      endDrag(e, true);
      return;
    }
    // ни драг, ни свайп: быстрый тап с малым смещением → тумблер раскрытия карточки
    if (lp.current) {
      if (lp.current.timer) clearTimeout(lp.current.timer);
      const moved = Math.hypot(e.clientX - lp.current.x, e.clientY - lp.current.y);
      const order = lp.current.order;
      lp.current = null;
      if (moved < 10) toggleExpand(order);
    }
  }
  function onCardPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (swiping.current) {
      try { lp.current?.el.releasePointerCapture(e.pointerId); } catch {}
      swiping.current = false;
      setSwipe(null);
      if (lp.current?.timer) clearTimeout(lp.current.timer);
      lp.current = null;
      return;
    }
    endDrag(e, false);
  }

  // самовосстановление Rework: вызов через CLI долгий, ответ server action может
  // потеряться в туннеле — поллим отпечаток шотов (groupBeatsStamp) и объявляем
  // успех сами, как только шоты в базе изменились. Маркер в localStorage (grevKey)
  // переживает уход со страницы: на ремаунте поллинг возобновляется, и результат
  // долетает, даже если пользователь ушёл на другой экран и вернулся.
  const revTimers = useRef<{
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const revDone = useRef(false);
  useEffect(
    () => () => {
      if (revTimers.current.poll) clearInterval(revTimers.current.poll);
      if (revTimers.current.refresh) clearInterval(revTimers.current.refresh);
    },
    [],
  );

  function clearRevMarker() {
    try {
      localStorage.removeItem(grevKey);
    } catch {}
  }
  function finishRevOk() {
    if (revDone.current) return;
    revDone.current = true;
    clearRevMarker();
    if (revTimers.current.poll) clearInterval(revTimers.current.poll);
    setRevising(false);
    setFeedback("");
    setDirty(false);
    setReworkOrders([]);
    toast(t("Группа переработана", "Group reworked"));
    // через туннель одиночный refresh теряется — повторяем несколько раз
    router.refresh();
    let n = 0;
    revTimers.current.refresh = setInterval(() => {
      router.refresh();
      if (++n >= 4 && revTimers.current.refresh) clearInterval(revTimers.current.refresh);
    }, 1000);
  }
  function finishRevErr(msg: string) {
    if (revDone.current) return;
    revDone.current = true;
    clearRevMarker();
    if (revTimers.current.poll) clearInterval(revTimers.current.poll);
    setRevising(false);
    setError(msg);
  }

  // потолок ожидания — по ВРЕМЕНИ от старта (переживает ремаунт: тики не сбрасываются).
  // Значение — модульная REV_CEILING_MS (с запасом над серверным худшим случаем)
  function startRevWatch(baseline: string | null, startedAt: number) {
    revStartRef.current = startedAt;
    if (baseline === null) return; // без ориентира не поллим — успех только по возврату
    if (revTimers.current.poll) clearInterval(revTimers.current.poll);
    revTimers.current.poll = setInterval(async () => {
      try {
        const stamp = await groupBeatsStamp(shotId);
        if (stamp !== baseline) {
          finishRevOk();
          return;
        }
      } catch {
        // сеть моргнула — попробуем в следующий тик
      }
      if (Date.now() - startedAt > REV_CEILING_MS) {
        // финальная перепроверка перед ошибкой — вдруг запись только что дошла
        try {
          const stamp = await groupBeatsStamp(shotId);
          if (stamp !== baseline) {
            finishRevOk();
            return;
          }
        } catch {}
        finishRevErr(
          t(
            "Ответа нет дольше 8 минут — переработка могла не примениться, попробуйте ещё раз.",
            "No response for over 8 minutes — the rework may not have applied, try again.",
          ),
        );
      }
    }, 4000);
  }

  // возврат на страницу во время реворка: маркер уже прочитан (revMarker),
  // здесь возобновляем поллинг — результат долетит, даже если ушли и вернулись.
  // Гашение таймеров — в общем unmount-эффекте выше (свой cleanup не нужен).
  useEffect(() => {
    if (!revMarker) return;
    revDone.current = false;
    startRevWatch(revMarker.stamp, revMarker.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // клик «Переделать» — СИНХРОННЫЙ обработчик (Date.now/setState компилятор видит
  // как event handler, а не render); тяжёлую асинхронную часть выносим в runRevise
  function onRevise() {
    setError("");
    revDone.current = false;
    const startedAt = nowMs();
    revStartRef.current = startedAt; // база для счётчика elapsed — сразу, без мигания
    setElapsed(0);
    setRevising(true);
    void runRevise(startedAt);
  }
  async function runRevise(startedAt: number) {
    // сперва сохраняем текущие правки: reviseGroup читает шоты ИЗ БАЗЫ, и если
    // ручная правка осталась только в состоянии страницы, реворк работал бы по
    // старому тексту (инцидент: «вернул сюжетный диалог вместо моих правок»)
    try {
      await updateGroupBeats(shotId, beats);
      setDirty(false);
    } catch {
      // не сохранилось — реворк всё равно пойдёт по тому, что уже в базе
    }
    let baseline: string | null = null;
    try {
      baseline = await groupBeatsStamp(shotId);
    } catch {
      // без ориентира — только по возврату основного запроса
    }
    // маркер (только при наличии ориентира) — чтобы поллинг возобновился на ремаунте
    if (baseline !== null) {
      try {
        localStorage.setItem(grevKey, JSON.stringify({ stamp: baseline, startedAt }));
      } catch {}
    }
    startRevWatch(baseline, startedAt);

    try {
      const res = await reviseGroup(shotId, feedback, validRework);
      if (res.ok) finishRevOk();
      else finishRevErr(res.error);
    } catch {
      // обрыв соединения (туннель): результат подхватит поллинг; без ориентира —
      // потолок выдаст понятную ошибку
      if (baseline === null)
        finishRevErr(t("Соединение прервалось — обновите страницу", "Connection lost — reload the page"));
    }
  }

  // только номера, которые реально есть в текущих шотах
  const validRework = reworkOrders.filter((o) => beats.some((b) => b.order === o));

  // приёмы для пикера: фильтр по названию/камере/тегам/категории
  const pq = pickQuery.trim().toLowerCase();
  const filteredTechniques = pq
    ? techniqueLibrary.filter((tq) =>
        `${tq.title} ${tq.camera} ${tq.tags} ${tq.category}`.toLowerCase().includes(pq),
      )
    : techniqueLibrary;

  return (
    <div
      className="relative flex flex-col gap-1.5"
      style={{ touchAction: drag ? "none" : undefined }}
    >
      {/* Локация сюжетной связки: одна на все группы сцены (до следующего scene_start);
          уходит в промпты Seedance всех связанных групп */}
      <CollapsePanel
        icon="📍"
        label="Location"
        summary={loc}
        emptyText={t("не задана", "not set")}
        dirty={locDirty}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-t400">
            {t("одна на сцену · уходит в промпты всей связки", "one per scene · goes into every linked group's prompt")}
          </span>
          <span className="flex-1" />
          {locDirty && (
            <button
              disabled={savingLoc}
              onClick={() =>
                startSaveLoc(async () => {
                  await updateGroupLocation(shotId, loc);
                  toast(t("Локация сцены сохранена (вся связка)", "Scene location saved (whole chain)"));
                })
              }
              className="rounded-md bg-violet-500 px-2.5 py-1 text-[10px] font-semibold uppercase text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {savingLoc ? t("…", "…") : t("Сохранить", "Save")}
            </button>
          )}
        </div>
        <input
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          placeholder={t(
            "Локация сцены (напр.: салон движущейся машины у кампуса Эшфорд)",
            "Scene location (e.g.: inside a moving car near the Ashford campus)",
          )}
          className={`${fieldCls} text-[12px] text-t200`}
        />
      </CollapsePanel>

      {/* Время суток и погода — тоже одни на сюжетную связку, уходят в промпты */}
      <CollapsePanel
        icon="🕓"
        label={t("Время и погода", "Time & weather")}
        summary={tw}
        emptyText={t("не заданы", "not set")}
        dirty={twDirty}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-t400">
            {t("одни на сцену · день/ночь, дождь…", "one per scene · day/night, rain…")}
          </span>
          <span className="flex-1" />
          {twDirty && (
            <button
              disabled={savingTw}
              onClick={() =>
                startSaveTw(async () => {
                  await updateGroupTimeWeather(shotId, tw);
                  toast(t("Время/погода сохранены (вся связка)", "Time/weather saved (whole chain)"));
                })
              }
              className="rounded-md bg-violet-500 px-2.5 py-1 text-[10px] font-semibold uppercase text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {savingTw ? t("…", "…") : t("Сохранить", "Save")}
            </button>
          )}
        </div>
        <input
          value={tw}
          onChange={(e) => setTw(e.target.value)}
          placeholder={t(
            "Время суток и погода (напр.: вечер, пасмурно, начинается дождь)",
            "Time of day & weather (e.g.: evening, overcast, rain starting)",
          )}
          className={`${fieldCls} text-[12px] text-t200`}
        />
        <div className="flex flex-wrap gap-1">
          {TW_PRESETS.map((p) => (
            <button
              key={p.en}
              onClick={() => addTwPreset(p.en)}
              className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-0.5 text-[10px] text-t300 hover:border-[var(--border-strong)] hover:text-t100"
            >
              {t(p.ru, p.en)}
            </button>
          ))}
        </div>
      </CollapsePanel>

      {/* Эмоциональный тон — СВОЙ у группы (не на связку); задаёт настроение/атмосферу
          именно этой группы в промпте, перекрывая общий тон сериала */}
      <CollapsePanel
        icon="🎭"
        label={t("Эмоциональный тон", "Emotional tone")}
        summary={tone}
        emptyText={t("не задан", "not set")}
        dirty={toneDirty}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-t400">
            {t("свой у группы · настроение сцены", "per group · sets the group's mood")}
          </span>
          <span className="flex-1" />
          {toneDirty && (
            <button
              disabled={savingTone}
              onClick={() =>
                startSaveTone(async () => {
                  await updateGroupEmotionalTone(shotId, tone);
                  toast(t("Тон группы сохранён", "Group tone saved"));
                })
              }
              className="rounded-md bg-violet-500 px-2.5 py-1 text-[10px] font-semibold uppercase text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {savingTone ? t("…", "…") : t("Сохранить", "Save")}
            </button>
          )}
        </div>
        <input
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder={t(
            "Эмоциональный тон (напр.: спокойный, тёплый / напряжённый, зловещий)",
            "Emotional tone (e.g.: calm, warm / tense, ominous)",
          )}
          className={`${fieldCls} text-[12px] text-t200`}
        />
        <div className="flex flex-wrap gap-1">
          {TONE_PRESETS.map((p) => (
            <button
              key={p.en}
              onClick={() => addTonePreset(p.en)}
              className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-0.5 text-[10px] text-t300 hover:border-[var(--border-strong)] hover:text-t100"
            >
              {t(p.ru, p.en)}
            </button>
          ))}
        </div>
      </CollapsePanel>

      {/* Сущности + Референсы шота: встают сразу после эмоционального тона,
          перед шотами группы (замечание заказчика) */}
      {topSlot}

      {/* карточка шота: одна разметка для обеих областей (Main/Draft), индекс —
          глобальный по массиву beats; data-beat-idx нужен drop-таргетингу dnd */}
      {(() => {
      const renderBeat = (b: GroupShot, i: number) => {
        const isEditing = editing.has(i);
        const inRework = validRework.includes(b.order);
        const isDragged = drag?.order === b.order;
        const isExpanded = expandedCards.has(b.order);
        const isSwiping = swipe?.order === b.order;
        // строки диалога (мультиперсонажный формат) + эвристика «есть что раскрывать»:
        // шеврон-подсказку показываем только когда в свёрнутом виде что-то прячется
        const dl = dialogueLines(b.dialogue);
        const hasMore =
          b.action.length > 42 ||
          b.framing.length + b.camera.length > 42 ||
          dl.length > 1 ||
          (dl[0]?.length ?? 0) > 42;
        return (
          <div
            key={i}
            data-beat-idx={i}
            data-beat-order={b.order}
            onPointerDown={(e) => onCardPointerDown(e, b.order, isEditing)}
            onPointerMove={onCardPointerMove}
            onPointerUp={onCardPointerUp}
            onPointerCancel={onCardPointerCancel}
            className={`drag-src relative overflow-hidden rounded-lg border p-2.5 transition-opacity ${
              b.draft ? "draft-hatch bg-ink-800" : "bg-ink-700"
            }`}
            style={{
              borderColor: inRework ? "var(--violet-400)" : "var(--border-subtle)",
              opacity: isDragged ? 0.45 : 1,
              cursor: isEditing ? "auto" : "grab",
              touchAction: drag ? "none" : "pan-y",
              transform: isSwiping ? `translateX(${swipe!.dx}px)` : undefined,
            }}
          >
            {/* индикатор свайпа влево → перенос в другую область (Main↔Draft) */}
            {isSwiping && (
              <span
                className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-l-lg bg-[rgba(139,95,176,.9)] px-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-white"
                style={{ opacity: Math.min(1, Math.abs(swipe!.dx) / SWIPE_TRIGGER) }}
              >
                → {b.draft ? "Main" : "Draft"}
              </span>
            )}
            <div className="mb-1 flex items-center gap-2">
              {!isEditing && <span className="select-none text-[11px] leading-none text-t400">⠿</span>}
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
                {t("Шот", "Shot")} {b.order}
                {b.time ? ` · ${b.time}` : ""}
                {` · ${beatSeconds(b)}${t("с", "s")}`}
              </span>
              {b.technique_id ? (
                <span
                  title={t(
                    `Закреплён режиссёрский приём «${techById.get(b.technique_id)?.title ?? b.technique_id}». ✕ — снять с шота`,
                    `Director technique “${techById.get(b.technique_id)?.title ?? b.technique_id}” attached. ✕ to remove`,
                  )}
                  className="inline-flex items-center gap-1 rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200"
                >
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickBeat(i);
                    }}
                    title={t("Сменить приём", "Change technique")}
                    className="max-w-[9rem] truncate leading-none hover:text-violet-100"
                  >
                    🎥 {techById.get(b.technique_id)?.title ?? b.technique_id}
                  </button>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTechnique(i);
                    }}
                    title={t("Снять приём с шота", "Remove technique from shot")}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full leading-none text-violet-100 hover:bg-[rgba(139,95,176,.45)] hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                techniqueLibrary.length > 0 && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickBeat(i);
                    }}
                    title={t(
                      "Закрепить режиссёрский приём за этим шотом",
                      "Attach a director technique to this shot",
                    )}
                    className="inline-flex items-center gap-1 rounded border border-dashed border-[rgba(139,95,176,.45)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-300 hover:border-[var(--violet-400)] hover:text-violet-100"
                  >
                    + 🎥
                  </button>
                )
              )}
              {/* закреплённые за шотом референсы (drag-and-drop миниатюры из «Референсы
                  шота»): мини-превью + якорь + ✕; висячие id (референс откреплён от
                  группы) не рендерятся — сравни с бейджем приёма выше */}
              {(b.ref_ids ?? []).map((rid) => {
                const rt = refThumbById.get(rid);
                if (!rt) return null;
                return (
                  <span
                    key={rid}
                    title={t(
                      `Референс ${rt.anchor || rt.role} закреплён за этим шотом — задаёт его вид/ракурс. ✕ — открепить`,
                      `Reference ${rt.anchor || rt.role} pinned to this shot — sets its view/angle. ✕ to unpin`,
                    )}
                    className="inline-flex items-center gap-1 rounded bg-[rgba(139,95,176,.18)] px-1 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={rt.url} alt="" draggable={false} className="h-4 w-[11px] rounded-[2px] object-cover" />
                    {rt.anchor && <span className="leading-none">{rt.anchor}</span>}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        unpinRefFromBeat(i, rid);
                      }}
                      title={t("Открепить референс от шота", "Unpin the reference from this shot")}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full leading-none text-violet-100 hover:bg-[rgba(139,95,176,.45)] hover:text-white"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
              {inRework && (
                <span className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200">
                  {t("в реворке", "in rework")}
                </span>
              )}
              <span className="flex-1" />
              {/* замок 🔒: только у основных шотов (черновики Enhance и так не трогает) */}
              {!b.draft && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLock(i);
                  }}
                  title={
                    b.locked
                      ? t(
                          "Шот защищён от Enhance: вернётся дословно, без разбиения и переписывания. Нажмите, чтобы снять замок",
                          "Protected from Enhance: returned verbatim, never split or rewritten. Click to unlock",
                        )
                      : t(
                          "Защитить шот от Enhance: вернётся дословно, без разбиения и переписывания",
                          "Protect this shot from Enhance: returned verbatim, never split or rewritten",
                        )
                  }
                  className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] ${
                    b.locked
                      ? "border-[var(--violet-400)] bg-[rgba(139,95,176,.18)] text-violet-200"
                      : "border-[var(--border-subtle)] text-t400 hover:border-[var(--border-strong)] hover:text-t100"
                  }`}
                >
                  {b.locked ? "🔒" : "🔓"}
                </button>
              )}
              {/* иконка активной модели: клик = промпт ТОЛЬКО этого шота (новая версия) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (genBeat === null) onGenShot(b.order);
                }}
                disabled={genBeat !== null}
                title={t(
                  `Сгенерировать промпт только этого шота для ${famMeta.label} (новая версия, старая сохранится)`,
                  `Generate a prompt for this shot only for ${famMeta.label} (new version, old kept)`,
                )}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 text-[10px] font-semibold text-t300 hover:border-[var(--border-strong)] hover:text-t100 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={famMeta.icon} alt="" className="h-3.5 w-3.5 rounded-[2px]" />
                {genBeat === b.order ? "…" : "⚡"}
              </button>
              <button
                onClick={() => toggleEdit(i)}
                title={isEditing ? t("Готово", "Done") : t("Редактировать", "Edit")}
                className="flex h-7 min-w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] px-1.5 font-mono text-[10px] text-t400 hover:border-[var(--border-strong)] hover:text-t100"
              >
                {isEditing ? "✓" : "✎"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeBeat(i);
                }}
                disabled={beats.length <= 1}
                title={t("Удалить шот", "Delete shot")}
                className="flex h-7 min-w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] px-1.5 font-mono text-[10px] text-t400 hover:border-danger hover:text-danger disabled:opacity-30"
              >
                🗑
              </button>
            </div>

            {isEditing ? (
              <div className="flex flex-col gap-1.5">
                {/* Длительность — степпер −/+, а не controlled type=number: на мобиле
                    контролируемый number с производным и обрезаемым значением «не
                    менялся» (при основных шотах на пределе 15с правка откатывалась,
                    и цифра не двигалась — замечание заказчика). Степпер надёжен. */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
                    {t("Длительность, сек", "Duration, sec")}
                  </span>
                  <div className="flex items-stretch overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-800">
                    <button
                      type="button"
                      aria-label={t("Меньше на секунду", "One second less")}
                      onClick={() => setBeatDuration(i, beatSeconds(b) - 1)}
                      disabled={beatSeconds(b) <= MIN_BEAT_SEC}
                      className="flex h-9 w-9 items-center justify-center text-[16px] leading-none text-t200 hover:bg-ink-600 hover:text-t100 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="flex h-9 min-w-[42px] items-center justify-center border-x border-[var(--border-subtle)] px-1 font-mono text-[13px] font-semibold text-t100">
                      {beatSeconds(b)}
                    </span>
                    <button
                      type="button"
                      aria-label={t("Больше на секунду", "One second more")}
                      onClick={() => setBeatDuration(i, beatSeconds(b) + 1)}
                      className="flex h-9 w-9 items-center justify-center text-[16px] leading-none text-t200 hover:bg-ink-600 hover:text-t100"
                    >
                      +
                    </button>
                  </div>
                  <span className="font-mono text-[9.5px] text-t400">{t("сек", "sec")}</span>
                </div>
                {/* framing/camera — тоже textarea c resize-y (как action/dialogue):
                    поле можно тянуть по высоте. rows=1 держит компактный дефолт */}
                <textarea
                  value={b.framing}
                  onChange={(e) => patch(i, { framing: e.target.value })}
                  rows={1}
                  placeholder={t("План и ракурс", "Framing & angle")}
                  className={`${fieldCls} resize-y font-mono text-[10.5px] leading-relaxed text-t300`}
                />
                <textarea
                  value={b.camera}
                  onChange={(e) => patch(i, { camera: e.target.value })}
                  rows={1}
                  placeholder={t("Что видит камера", "What the camera sees")}
                  className={`${fieldCls} resize-y font-mono text-[10.5px] leading-relaxed text-t300`}
                />
                <textarea
                  value={b.action}
                  onChange={(e) => patch(i, { action: e.target.value })}
                  rows={2}
                  placeholder={t("Действие и эмоция", "Action & emotion")}
                  className={`${fieldCls} resize-y text-[12px] leading-relaxed text-t200`}
                />
                {/* Диалог — по строке на реплику каждого персонажа (мультиперсонажный
                    формат «[Имя]: -фраза», манера речи — «[Имя](эмоция): -фраза»);
                    textarea допускает переводы строк */}
                <textarea
                  value={b.dialogue}
                  onChange={(e) => patch(i, { dialogue: e.target.value })}
                  rows={2}
                  placeholder={t(
                    "Диалог — по строке на реплику:\n[Имя]: -фраза\n[Имя](whisper): -фраза",
                    "Dialogue — one line per cue:\n[Name]: -line\n[Name](whisper): -line",
                  )}
                  className={`${fieldCls} resize-y whitespace-pre-wrap text-[12px] text-violet-200 placeholder:text-t400`}
                />
              </div>
            ) : (
              <>
                {(b.framing || b.camera) && (
                  <div
                    className={`mb-1 font-mono text-[10px] leading-relaxed text-t400 ${isExpanded ? "" : "truncate"}`}
                  >
                    {b.framing && <>🎥 {b.framing}</>}
                    {b.framing && b.camera && " · "}
                    {b.camera}
                  </div>
                )}
                {b.action && (
                  <div
                    className={`text-[12px] leading-relaxed text-t200 ${isExpanded ? "whitespace-pre-wrap" : "truncate"}`}
                  >
                    {b.action}
                  </div>
                )}
                {b.dialogue &&
                  (isExpanded ? (
                    // раскрыто: каждая реплика на своей строке — «[Имя]: -фраза»
                    <div className="mt-1 flex flex-col gap-0.5 text-[12px] leading-relaxed text-violet-200">
                      {dl.map((ln, k) => (
                        <div key={k}>{ln}</div>
                      ))}
                    </div>
                  ) : (
                    // свёрнуто: весь диалог в одну строку с обрезкой …
                    <div className="mt-1 truncate text-[12px] leading-relaxed text-violet-200">
                      {dl.join("  ·  ")}
                    </div>
                  ))}
                {/* тап по карточке раскрывает/сворачивает — шеврон только если есть что прятать */}
                {hasMore && (
                  <div className="mt-1 flex justify-center text-[9px] leading-none text-t400">
                    {isExpanded ? "⌃" : "⌄"}
                  </div>
                )}
              </>
            )}
          </div>
        );
      };
      const draftsSec = beats.filter((b) => b.draft).reduce((a, b) => a + beatSeconds(b), 0);
      const draftCount = beats.filter((b) => b.draft).length;
      // спойлер раскрыт строго по флагу. При перетаскивании НЕ распахиваем: захват
      // основного шота не должен открывать черновики (замечание заказчика). Бросок на
      // свёрнутую шапку всё равно сработает — у контейнера есть data-beat-area="draft",
      // а moveBeat после переноса в черновики сам раскроет спойлер.
      const draftsShown = draftsOpen;
      return (
        <>
          {/* ---------- Main Shots: идут в тайминг, лимит 15 сек и Seedance-промпт ---------- */}
          <div
            data-beat-area="main"
            className="flex flex-col gap-1.5 rounded-lg p-1 transition-colors"
            style={drag ? { outline: "1.5px dashed var(--violet-400)", outlineOffset: 2 } : undefined}
          >
            <div className="flex items-center gap-2 px-1">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t300">
                🎬 Main Shots
              </span>
              <span className="text-[9px] text-t400">
                {t("идут в видео и промпт", "go into the video & prompt")}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 font-mono text-[9.5px] text-t400">
                {mainSeconds(beats)}/{MAX_GROUP_SEC} {t("сек", "sec")}
              </span>
            </div>
            {beats.map((b, i) => (b.draft ? null : renderBeat(b, i)))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={addBeat}
              className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-default)] text-[11px] font-semibold text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
            >
              <span className="text-[14px] leading-none">+</span>
              {t("Добавить шот", "Add shot")}
            </button>
            <button
              onClick={addDraft}
              title={t(
                "Черновой шот: запасной вариант сцены — не входит в 15 сек и в промпт",
                "Draft shot: a spare take — excluded from the 15s limit and the prompt",
              )}
              className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-[rgba(139,95,176,.45)] text-[11px] font-semibold text-violet-300 hover:border-[var(--violet-400)] hover:text-violet-100"
            >
              <span className="text-[14px] leading-none">+</span>
              {t("Черновик", "Add draft")}
            </button>
          </div>

          {/* ---------- Rework: свёрнутый спойлер ПОД Main Shots (замечание заказчика).
              Во время перетаскивания раскрывается сам — иначе шот некуда бросить ---------- */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setReworkOpen((v) => !v)}
              aria-expanded={reworkOpen || Boolean(drag)}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border-default)] px-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
            >
              <span className="shrink-0 text-[11px] leading-none text-violet-300">✎</span>
              <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t300">
                Rework
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-[9px] text-t400 sm:block">
                {t("переделать шоты по замечанию — Claude", "rework shots per feedback — Claude")}
              </span>
              <span className="flex-1 sm:hidden" />
              {validRework.length > 0 && (
                <span className="shrink-0 rounded-full bg-[rgba(139,95,176,.22)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-violet-200">
                  {validRework.length}
                </span>
              )}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-ink-700 text-[10px] leading-none text-t200">
                {reworkOpen || Boolean(drag) ? "▴" : "▾"}
              </span>
            </button>
            {(reworkOpen || Boolean(drag)) && (
              <div
                ref={dropRef}
                className="flex flex-col gap-1.5 rounded-lg border border-dashed p-2.5 transition-colors"
                style={{
                  borderColor: drag?.over ? "var(--violet-400)" : "var(--border-default)",
                  background: drag?.over ? "rgba(139,95,176,.08)" : "transparent",
                }}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {validRework.length === 0 ? (
                    <span className="text-[10px] text-t400">
                      {drag
                        ? t("отпустите здесь", "drop here")
                        : t(
                            "перетащите сюда шоты (долгое нажатие), чтобы менять только их",
                            "drag shots here (long-press) to rework only them",
                          )}
                    </span>
                  ) : (
                    validRework.map((o) => (
                      <span
                        key={o}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-ink-600 py-0.5 pl-2 pr-1 text-[10px] font-semibold text-violet-200"
                      >
                        {t("Шот", "Shot")} {o}
                        <button
                          onClick={() => removeRework(o)}
                          aria-label={t("Убрать", "Remove")}
                          className="flex h-4 w-4 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>

                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  placeholder={t(
                    "Замечание к группе: что переделать (темп, планы, реплики, эмоции)…",
                    "Feedback for the group: what to rework (pace, framing, dialogue, emotion)…",
                  )}
                  className="w-full resize-y rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
                />
                <div className="text-[9.5px] leading-snug text-t400">
                  {validRework.length > 0
                    ? t(
                        `Правка применится только к шотам ${validRework.join(", ")}. Остальные останутся без изменений.`,
                        `The rework applies only to shots ${validRework.join(", ")}. The rest stay unchanged.`,
                      )
                    : t(
                        "Шоты не выбраны — Claude сам определит, каких шотов касается замечание.",
                        "No shots selected — Claude decides which shots the feedback affects.",
                      )}
                </div>
                {error && <div className="text-[11px] text-danger">{error}</div>}
                <button
                  onClick={onRevise}
                  disabled={revising || !feedback.trim()}
                  className="min-h-11 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:bg-ink-500 disabled:opacity-50"
                >
                  {revising
                    ? t(`Claude переделывает… ${elapsed}с`, `Claude is reworking… ${elapsed}s`)
                    : validRework.length > 0
                      ? t(
                          `Переделать шоты ${validRework.join(", ")} · ${reviseCost}`,
                          `Rework shots ${validRework.join(", ")} · ${reviseCost}`,
                        )
                      : t(`Переделать по замечанию · ${reviseCost}`, `Rework per feedback · ${reviseCost}`)}
                </button>
              </div>
            )}
          </div>

          {/* ---------- Draft Shots: запаски при группе, своя шкала времени.
              Спойлер: заголовок-переключатель; бросок на шапку переносит шот сюда ---------- */}
          <div
            data-beat-area="draft"
            className="flex flex-col gap-1.5 rounded-lg p-1 transition-colors"
            style={drag ? { outline: "1.5px dashed var(--violet-400)", outlineOffset: 2 } : undefined}
          >
            <button
              type="button"
              onClick={() => setDraftsOpen((v) => !v)}
              aria-expanded={draftsShown}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-[rgba(139,95,176,.35)] bg-[rgba(139,95,176,.06)] px-2.5 text-left transition-colors hover:border-[var(--violet-400)] hover:bg-[rgba(139,95,176,.12)]"
            >
              <span className="shrink-0 text-[11px] leading-none text-violet-300">▦</span>
              <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                Draft Shots
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-[9px] text-t400 sm:block">
                {t(
                  "запасные варианты · не в тайминге и не в промпте",
                  "spare takes · excluded from timing & prompt",
                )}
              </span>
              <span className="flex-1 sm:hidden" />
              {!draftsShown && draftCount > 0 && (
                <span className="shrink-0 rounded-full bg-[rgba(139,95,176,.22)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-violet-200">
                  {draftCount}
                </span>
              )}
              {draftsSec > 0 && (
                <span className="shrink-0 font-mono text-[9.5px] text-t400">
                  Σ {draftsSec} {t("сек", "sec")}
                </span>
              )}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[rgba(139,95,176,.35)] bg-ink-700 text-[10px] leading-none text-violet-200">
                {draftsShown ? "▴" : "▾"}
              </span>
            </button>
            {draftsShown && (
              <>
                {beats.map((b, i) => (b.draft ? renderBeat(b, i) : null))}
                {beats.every((b) => !b.draft) && (
                  <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-3 text-center text-[10px] text-t400">
                    {drag
                      ? t("отпустите здесь — шот станет черновиком", "drop here — the shot becomes a draft")
                      : t(
                          "пусто · перетащите сюда шот (долгое нажатие) или нажмите «+ Черновик»",
                          "empty · drag a shot here (long-press) or press “+ Add draft”",
                        )}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      );
      })()}

      {/* Пикер режиссёрского приёма: ручное закрепление за шотом */}
      <Sheet
        open={pickBeat !== null}
        onClose={() => {
          setPickBeat(null);
          setPickQuery("");
        }}
        title={t("Режиссёрский приём", "Director technique")}
      >
        <div className="mb-2 text-[10.5px] leading-relaxed text-t400">
          {t(
            "Выберите приём — его язык вплетётся в промпт при генерации этого шота.",
            "Pick a technique — its language is woven into the prompt when this shot is generated.",
          )}
        </div>
        <input
          value={pickQuery}
          onChange={(e) => setPickQuery(e.target.value)}
          placeholder={t("Поиск: название, камера, тег…", "Search: title, camera, tag…")}
          className={`${fieldCls} text-[12px] text-t200`}
        />
        <div className="mt-2 flex flex-col gap-1.5 pb-2">
          {filteredTechniques.map((tq) => {
            const active = pickBeat !== null && beats[pickBeat]?.technique_id === tq.id;
            return (
              <button
                key={tq.id}
                onClick={() => pickBeat !== null && setTechniqueFor(pickBeat, tq.id)}
                className="rounded-lg border p-2.5 text-left transition-colors"
                style={{
                  borderColor: active ? "var(--violet-400)" : "var(--border-subtle)",
                  background: active ? "var(--ink-600)" : "var(--ink-800)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] leading-none">🎥</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-t100">
                    {tq.title}
                  </span>
                  {tq.category && (
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-t400">
                      {tq.category}
                    </span>
                  )}
                </div>
                {(tq.camera || tq.tags) && (
                  <div className="mt-1 font-mono text-[10px] leading-relaxed text-t400">
                    {tq.camera}
                    {tq.camera && tq.tags ? " · " : ""}
                    {tq.tags}
                  </div>
                )}
              </button>
            );
          })}
          {filteredTechniques.length === 0 && (
            <div className="px-1 py-3 text-center text-[11px] text-t400">
              {t("Ничего не найдено", "Nothing found")}
            </div>
          )}
        </div>
      </Sheet>

      {/* ghost под пальцем */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[80] rounded-md border border-[var(--violet-400)] bg-ink-600 px-2.5 py-1 font-mono text-[10px] font-semibold text-violet-100 shadow-lg"
          style={{ left: drag.x, top: drag.y, transform: "translate(-50%, -140%)" }}
        >
          {t("Шот", "Shot")} {drag.order}
          {drag.over ? ` → Rework` : ""}
        </div>
      )}
    </div>
  );
}
