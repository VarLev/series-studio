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
  reviseGroup,
  enhanceGroup,
  updateGroupLocation,
  updateGroupTimeWeather,
  updateGroupEmotionalTone,
} from "@/lib/actions/shots";
import { generateSingleShotPrompt } from "@/lib/actions/prompts";
import type { GroupShot } from "@/lib/llm/contracts";
import { CHEAPEST_LLM, PROMPT_FAMILIES, isClaudeModel } from "@/lib/llm/models";
import { estTextUsd, LLM_PRICES, OUT_TOKENS, fmtUsd } from "@/lib/pricing";
import { usePromptTrack } from "@/components/shot/PromptTrackContext";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

const fieldCls =
  "w-full rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 outline-none focus:border-[var(--border-strong)]";

const MIN_BEAT_SEC = 1;
const MAX_GROUP_SEC = 15;
const TIME_RE = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/;

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
/** Пересчитать «00:00–00:05» у всех шотов подряд по заданным длительностям. */
function retimeWithDurations(list: GroupShot[], durations: number[]): GroupShot[] {
  let cursor = 0;
  return list.map((b, idx) => {
    const d = durations[idx];
    const time = `${fmtBeatTime(cursor)}–${fmtBeatTime(cursor + d)}`;
    cursor += d;
    return { ...b, order: idx + 1, time };
  });
}

interface DragState {
  order: number;
  x: number;
  y: number;
  over: boolean;
}

export default function GroupShotsEditor({
  shotId,
  initialBeats,
  simpleModel = CHEAPEST_LLM,
  llmModel,
  location = "",
  timeWeather = "",
  emotionalTone = "",
  useCli = false,
}: {
  shotId: string;
  initialBeats: GroupShot[];
  /** «модель для простых запросов» из настроек — ей идёт переделка группы */
  simpleModel?: string;
  /** ИИ для промпт-фабрики (та же, что в блоке промпта) — генерит промпт одного шота */
  llmModel?: string;
  /** локация сюжетной связки (одна до следующего «начала сцены») */
  location?: string;
  /** время суток и погода сюжетной связки (тоже одни на сцену) */
  timeWeather?: string;
  /** эмоциональный тон группы — свой у каждой группы (не единый на сцену) */
  emotionalTone?: string;
  /** llm_use_cli на /costs — Claude-вызовы идут через подписку, не по цене API */
  useCli?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const estModel = LLM_PRICES[simpleModel] ? simpleModel : CHEAPEST_LLM;
  // при включённом CLI Claude-вызов идёт через подписку — цена в $ не расходуется
  const viaCli = useCli && isClaudeModel(simpleModel);
  const reviseCost = viaCli ? "(CLI)" : `~${fmtUsd(estTextUsd(estModel, 1500, OUT_TOKENS.revise))}`;
  const [beats, setBeats] = useState<GroupShot[]>(initialBeats);
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [saving, startSave] = useTransition();
  // Enhance: полная переоценка группы на Opus через CLI (свой таймер/ошибка)
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceElapsed, setEnhanceElapsed] = useState(0);

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
  async function onGenShot(order: number) {
    setGenBeat(order);
    const res = await generateSingleShotPrompt(shotId, family, order, llmModel);
    setGenBeat(null);
    if (res.ok) {
      setOpen(family, res.promptId); // открытой станет новая версия — она уйдёт в генерацию
      toast(t(`Промпт шота ${order} создан (${famMeta.label}) — открыт`, `Shot ${order} prompt created (${famMeta.label}) — opened`));
      router.refresh();
    } else toast(res.error);
  }

  // шоты, добавленные в Rework (правка ограничивается ими); порядок добавления
  const [reworkOrders, setReworkOrders] = useState<number[]>([]);
  // перетаскивание: ghost под пальцем + подсветка drop-зоны
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragActive = useRef(false); // синхронный флаг (без гонок со стейтом)
  const dropRef = useRef<HTMLDivElement>(null);
  const lp = useRef<
    { timer?: ReturnType<typeof setTimeout>; order: number; x: number; y: number; pointerId: number; el: HTMLElement } | null
  >(null);

  // после reviseGroup сервер отдаёт новые шоты — принимаем их, если нет своих
  // правок; список Rework сбрасываем (номера могли перенумероваться)
  const [prevInitial, setPrevInitial] = useState(initialBeats);
  if (prevInitial !== initialBeats) {
    setPrevInitial(initialBeats);
    if (!dirty) {
      setBeats(initialBeats);
      setEditing(new Set());
    }
    setReworkOrders([]);
  }

  useEffect(() => {
    if (!revising) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [revising]);

  useEffect(() => {
    if (!enhancing) return;
    const t0 = Date.now();
    const id = setInterval(() => setEnhanceElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [enhancing]);

  async function onEnhance() {
    setError("");
    setEnhanceElapsed(0);
    setEnhancing(true);
    const res = await enhanceGroup(shotId);
    setEnhancing(false);
    if (res.ok) {
      setDirty(false); // прилетят новые initialBeats — синхронизируем с сервером
      toast(t("Группа улучшена (Opus)", "Group enhanced (Opus)"));
      router.refresh();
    } else setError(res.error);
  }

  useEffect(() => () => { if (lp.current?.timer) clearTimeout(lp.current.timer); }, []);

  function toggleEdit(i: number) {
    setEditing((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function patch(i: number, p: Partial<GroupShot>) {
    setBeats(beats.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
    setDirty(true);
  }

  // длительность шота — в секундах; диапазоны всех шотов группы пересчитываются
  // сразу же (программно, без ИИ), сумма ограничена длиной группы (≤15 сек)
  function setBeatDuration(i: number, seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const durations = beats.map(beatSeconds);
    durations[i] = Math.max(MIN_BEAT_SEC, Math.round(seconds));
    const total = durations.reduce((a, b) => a + b, 0);
    if (total > MAX_GROUP_SEC) {
      toast(
        t(
          `Группа не может быть длиннее ${MAX_GROUP_SEC} секунд (вышло бы ${total})`,
          `A shot group can't exceed ${MAX_GROUP_SEC} seconds (would be ${total})`,
        ),
      );
      return;
    }
    setBeats(retimeWithDurations(beats, durations));
    setDirty(true);
  }

  function addBeat() {
    const durations = [...beats.map(beatSeconds), 2];
    const total = durations.reduce((a, b) => a + b, 0);
    if (total > MAX_GROUP_SEC) {
      toast(
        t(
          `Нельзя добавить шот — группа не может быть длиннее ${MAX_GROUP_SEC} секунд`,
          `Can't add a shot — a group can't exceed ${MAX_GROUP_SEC} seconds`,
        ),
      );
      return;
    }
    const next: GroupShot[] = [
      ...beats,
      { order: beats.length + 1, time: "", framing: "", camera: "", action: "", dialogue: "", technique_id: "" },
    ];
    setBeats(retimeWithDurations(next, durations));
    setEditing((prev) => new Set(prev).add(next.length - 1));
    setDirty(true);
  }

  function removeBeat(i: number) {
    if (beats.length <= 1) return;
    const remaining = beats.filter((_, idx) => idx !== i);
    const durations = remaining.map(beatSeconds);
    setBeats(retimeWithDurations(remaining, durations));
    setEditing((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx === i) continue;
        next.add(idx > i ? idx - 1 : idx);
      }
      return next;
    });
    setDirty(true);
  }

  function save() {
    startSave(async () => {
      await updateGroupBeats(shotId, beats);
      setDirty(false);
      setEditing(new Set());
      toast(t("Шоты сохранены", "Shots saved"));
    });
  }

  // ---------- Drag & drop шотов в Rework ----------
  function isOverDrop(x: number, y: number): boolean {
    const r = dropRef.current?.getBoundingClientRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  }
  function addRework(order: number) {
    setReworkOrders((prev) => (prev.includes(order) ? prev : [...prev, order]));
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
    if (lp.current) {
      // сдвинулись до срабатывания долгого нажатия → это скролл, отменяем захват
      if (Math.hypot(e.clientX - lp.current.x, e.clientY - lp.current.y) > 10) {
        if (lp.current.timer) clearTimeout(lp.current.timer);
        lp.current = null;
      }
    }
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>, drop: boolean) {
    if (lp.current?.timer) clearTimeout(lp.current.timer);
    if (dragActive.current) {
      if (drop && isOverDrop(e.clientX, e.clientY) && drag) addRework(drag.order);
      try { lp.current?.el.releasePointerCapture(e.pointerId); } catch {}
      dragActive.current = false;
      setDrag(null);
    }
    lp.current = null;
  }

  async function onRevise() {
    setElapsed(0);
    setRevising(true);
    setError("");
    const res = await reviseGroup(shotId, feedback, validRework);
    setRevising(false);
    if (res.ok) {
      setFeedback("");
      setDirty(false);
      setReworkOrders([]);
      toast(t("Группа переработана", "Group reworked"));
      router.refresh(); // подтянуть обновлённые шоты в дерево
    } else setError(res.error);
  }

  // только номера, которые реально есть в текущих шотах
  const validRework = reworkOrders.filter((o) => beats.some((b) => b.order === o));

  return (
    <div
      className="relative flex flex-col gap-1.5"
      style={{ touchAction: drag ? "none" : undefined }}
    >
      {/* Enhance: Opus через CLI переоценивает всю группу — шоты, тайминг, приёмы,
          локацию/погоду/тон и «кто в кадре». Всегда подписка (не тратит $). */}
      <button
        onClick={onEnhance}
        disabled={enhancing}
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--violet-400)] bg-[rgba(139,95,176,.12)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-100 hover:bg-[rgba(139,95,176,.2)] disabled:opacity-60"
        style={{ boxShadow: "var(--glow-violet-sm)" }}
        title={t(
          "Opus переоценит группу: перепишет шоты и тайминг, подберёт режиссёрские приёмы, заполнит локацию/погоду/тон и определит, кто в кадре",
          "Opus re-evaluates the group: rewrites shots & timing, picks director techniques, fills location/weather/tone and detects who's in frame",
        )}
      >
        {enhancing
          ? t(`Opus улучшает… ${enhanceElapsed}с`, `Opus enhancing… ${enhanceElapsed}s`)
          : t("✨ Enhance · Opus (CLI)", "✨ Enhance · Opus (CLI)")}
      </button>
      {error && !revising && <div className="text-[11px] text-danger">{error}</div>}

      {/* Локация сюжетной связки: одна на все группы сцены (до следующего scene_start);
          уходит в промпты Seedance всех связанных групп */}
      <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
            📍 Location
          </span>
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
      </div>

      {/* Время суток и погода — тоже одни на сюжетную связку, уходят в промпты */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
            🕓 {t("Время и погода", "Time & weather")}
          </span>
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
      </div>

      {/* Эмоциональный тон — СВОЙ у группы (не на связку); задаёт настроение/атмосферу
          именно этой группы в промпте, перекрывая общий тон сериала */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
            🎭 {t("Эмоциональный тон", "Emotional tone")}
          </span>
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
      </div>

      {beats.map((b, i) => {
        const isEditing = editing.has(i);
        const inRework = validRework.includes(b.order);
        const isDragged = drag?.order === b.order;
        return (
          <div
            key={i}
            onPointerDown={(e) => onCardPointerDown(e, b.order, isEditing)}
            onPointerMove={onCardPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            className="drag-src rounded-lg border bg-ink-700 p-2.5 transition-opacity"
            style={{
              borderColor: inRework ? "var(--violet-400)" : "var(--border-subtle)",
              opacity: isDragged ? 0.45 : 1,
              cursor: isEditing ? "auto" : "grab",
              touchAction: drag ? "none" : "pan-y",
            }}
          >
            <div className="mb-1 flex items-center gap-2">
              {!isEditing && <span className="select-none text-[11px] leading-none text-t400">⠿</span>}
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
                {t("Шот", "Shot")} {b.order}
                {b.time ? ` · ${b.time}` : ""}
              </span>
              {b.technique_id && (
                <span
                  title={t(
                    `Закреплён режиссёрский приём ${b.technique_id} (Enhance)`,
                    `Director technique ${b.technique_id} attached (Enhance)`,
                  )}
                  className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200"
                >
                  🎥 {b.technique_id}
                </span>
              )}
              {inRework && (
                <span className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200">
                  {t("в реворке", "in rework")}
                </span>
              )}
              <span className="flex-1" />
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
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
                    {t("Длительность, сек", "Duration, sec")}
                  </span>
                  <input
                    type="number"
                    min={MIN_BEAT_SEC}
                    max={MAX_GROUP_SEC}
                    step={1}
                    value={beatSeconds(b)}
                    onChange={(e) => setBeatDuration(i, Number(e.target.value))}
                    className={`${fieldCls} w-20 font-mono text-[11px] text-t200`}
                  />
                </div>
                <input
                  value={b.framing}
                  onChange={(e) => patch(i, { framing: e.target.value })}
                  placeholder={t("План и ракурс", "Framing & angle")}
                  className={`${fieldCls} font-mono text-[10.5px] text-t300`}
                />
                <input
                  value={b.camera}
                  onChange={(e) => patch(i, { camera: e.target.value })}
                  placeholder={t("Что видит камера", "What the camera sees")}
                  className={`${fieldCls} font-mono text-[10.5px] text-t300`}
                />
                <textarea
                  value={b.action}
                  onChange={(e) => patch(i, { action: e.target.value })}
                  rows={2}
                  placeholder={t("Действие и эмоция", "Action & emotion")}
                  className={`${fieldCls} resize-y text-[12px] leading-relaxed text-t200`}
                />
                <input
                  value={b.dialogue}
                  onChange={(e) => patch(i, { dialogue: e.target.value })}
                  placeholder={t("Реплика (если есть)", "Dialogue (if any)")}
                  className={`${fieldCls} text-[12px] text-violet-200 placeholder:text-t400`}
                />
              </div>
            ) : (
              <>
                {(b.framing || b.camera) && (
                  <div className="mb-1 font-mono text-[10px] leading-relaxed text-t400">
                    {b.framing && <>🎥 {b.framing}</>}
                    {b.framing && b.camera && " · "}
                    {b.camera}
                  </div>
                )}
                {b.action && (
                  <div className="text-[12px] leading-relaxed text-t200">{b.action}</div>
                )}
                {b.dialogue && (
                  <div className="mt-1 text-[12px] leading-relaxed text-violet-200">
                    «{b.dialogue}»
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <button
          onClick={addBeat}
          className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-default)] text-[11px] font-semibold text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          <span className="text-[14px] leading-none">+</span>
          {t("Добавить шот", "Add shot")}
        </button>
        <span className="shrink-0 font-mono text-[9.5px] text-t400">
          {beats.reduce((a, b) => a + beatSeconds(b), 0)}/{MAX_GROUP_SEC} {t("сек", "sec")}
        </span>
      </div>

      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="min-h-11 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {saving ? t("Сохранение…", "Saving…") : t("Сохранить шоты", "Save shots")}
        </button>
      )}

      {/* Rework: drop-зона + чипы добавленных шотов + замечание */}
      <div
        ref={dropRef}
        className="mt-1 flex flex-col gap-1.5 rounded-lg border border-dashed p-2.5 transition-colors"
        style={{
          borderColor: drag?.over ? "var(--violet-400)" : "var(--border-default)",
          background: drag?.over ? "rgba(139,95,176,.08)" : "transparent",
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
            Rework
          </span>
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
