/**
 * Тайминг раскадровки v2: внутри группы шоты отсчитываются от 00:00
 * (каждая группа — отдельное видео), а таймкод самой группы — сквозной
 * по эпизоду и пересчитывается программно, а не берётся у модели.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, shots } from "@/lib/db";
import type { GroupShot } from "@/lib/llm/contracts";

const RANGE_RE = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/;

/** «00:26–00:40» → [26, 40] в секундах; null, если строка не парсится. */
export function parseTimeRange(s: string): [number, number] | null {
  const m = s.match(RANGE_RE);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return end > start ? [start, end] : null;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// разговорный темп ≈150 слов/мин (2.5 слова/сек) + доля секунды на интонацию/
// стык с действием — та же формула, что дана модели в TIMING_RULES (templates.ts)
const WORDS_PER_SEC = 2.5;
const REACTION_PAD_SEC = 0.6;

/**
 * Точное время на произнесение реплики (сек) — считается программно по числу
 * слов, а не оставляется на глазомер модели. Пустая реплика → 0.
 */
export function estimateSpeechSeconds(dialogue: string): number {
  const words = dialogue.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  return words.length / WORDS_PER_SEC + REACTION_PAD_SEC;
}

/**
 * Сумма длительностей шотов группы, посчитанная из их time-диапазонов (сек).
 * Источник истины для durationSec группы после ручной правки шотов (добавление/
 * удаление/правка секунд одного шота) — считается программно, без участия ИИ.
 */
export function sumBeatsDurationSec(beats: GroupShot[]): number {
  return beats.reduce((sum, b) => {
    const r = parseTimeRange(b.time);
    return sum + (r ? r[1] - r[0] : 0);
  }, 0);
}

/**
 * Нормализовать шоты группы: длительности берём из времени модели (в любом
 * отсчёте), а сами метки перезаписываем от 00:00. Длительность реплики —
 * нижняя граница шота: считается программно по числу слов (estimateSpeechSeconds),
 * а не берётся на веру из тайминга, который дала модель — подстраховка от
 * шотов, где реплика длиннее выделенного модель времени. Возвращает шоты и
 * итоговую длительность группы.
 * Известное ограничение: если реплики реально не помещаются в 15 сек даже
 * после подстраховки — durationSec всё равно клампится к 15 (сумма шотов
 * теоретически может чуть превысить кламп); материал в такой сцене стоит
 * разбивать на несколько групп — см. TIMING_RULES в lib/templates.ts.
 */
export function normalizeBeats(
  rawBeats: GroupShot[],
  fallbackDurationSec: number,
): { beats: GroupShot[]; durationSec: number } {
  const sorted = [...rawBeats].sort((a, b) => a.order - b.order);
  if (!sorted.length) {
    return { beats: [], durationSec: Math.min(15, Math.max(3, fallbackDurationSec)) };
  }
  const parsed = sorted.map((b) => parseTimeRange(b.time));
  const durations = sorted.map((b, i) => {
    const p = parsed[i];
    const base = p ? p[1] - p[0] : Math.max(1, Math.round(fallbackDurationSec / sorted.length));
    return Math.max(base, estimateSpeechSeconds(b.dialogue));
  });
  let cursor = 0;
  const beats = sorted.map((b, i) => {
    const time = `${fmtTime(cursor)}–${fmtTime(cursor + durations[i])}`;
    cursor += durations[i];
    return { ...b, order: i + 1, time };
  });
  return { beats, durationSec: Math.min(15, Math.max(3, cursor)) };
}

/** Текст фрагмента группы для списка и промпт-фабрики: строка на шот. */
export function composeActionMd(beats: GroupShot[], fallback: string): string {
  if (!beats.length) return fallback;
  return beats
    .map((b) => {
      const head = `Шот ${b.order}${b.time ? ` (${b.time})` : ""}: `;
      const parts = [b.action || b.camera || b.framing];
      if (b.dialogue) parts.push(`«${b.dialogue}»`);
      return head + parts.filter(Boolean).join(" — ");
    })
    .join("\n");
}

/**
 * Сюжетная связка группы: от начала её сцены (первая группа эпизода или
 * scene_start=true) до группы перед следующим scene_start. Локация едина
 * на всю связку — берётся отсюда и для UI, и для промпт-фабрики.
 * Вставные группы (is_insert) в связку НЕ входят: у них свои локация/погода —
 * для вставки связка = она сама, из чужих связок вставки исключаются.
 */
export function sceneChainOf<T extends { id: string; sceneStart: boolean; isInsert: boolean }>(
  rows: T[],
  shotId: string,
): T[] {
  const idx = rows.findIndex((r) => r.id === shotId);
  if (idx === -1) return [];
  if (rows[idx].isInsert) return [rows[idx]]; // вставка — сама себе связка
  let start = 0;
  for (let i = idx; i >= 0; i--) {
    if (i === 0 || (rows[i].sceneStart && !rows[i].isInsert)) {
      start = i;
      break;
    }
  }
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    if (rows[i].sceneStart && !rows[i].isInsert) {
      end = i;
      break;
    }
  }
  return rows.slice(start, end).filter((r) => !r.isInsert);
}

/**
 * Отображаемые номера групп серии: считают только НЕ вставные группы —
 * вставки в нумерацию не входят и её не сдвигают (своя мини-сцена, own clock).
 * 0 у вставки означает «номера нет» — UI показывает вместо него свою метку.
 */
export function displayGroupNumbers<T extends { id: string; isInsert: boolean }>(
  rows: T[],
): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const r of rows) {
    if (!r.isInsert) n++;
    map.set(r.id, r.isInsert ? 0 : n);
  }
  return map;
}

/** Значение поля для связки: стартовой группы сцены, иначе первой непустой в связке. */
function chainPick<T extends { id: string; sceneStart: boolean; isInsert: boolean }>(
  rows: T[],
  shotId: string,
  get: (r: T) => string,
): string {
  const chain = sceneChainOf(rows, shotId);
  const first = chain[0] ? (get(chain[0]) ?? "").trim() : "";
  if (first) return first;
  const found = chain.find((s) => (get(s) ?? "").trim());
  return found ? get(found).trim() : "";
}

/** Локация связки (WHERE) — одна на всю сцену. */
export function chainLocation<
  T extends { id: string; sceneStart: boolean; isInsert: boolean; location: string },
>(rows: T[], shotId: string): string {
  return chainPick(rows, shotId, (r) => r.location);
}

/** Время суток и погода связки (WHEN/условия) — одни на всю сцену. */
export function chainTimeWeather<
  T extends { id: string; sceneStart: boolean; isInsert: boolean; timeWeather: string },
>(rows: T[], shotId: string): string {
  return chainPick(rows, shotId, (r) => r.timeWeather);
}

/**
 * Сквозной таймкод групп эпизода: пересчитывается по порядку и фактическим
 * длительностям после любого изменения (раскадровка, правка группы).
 * Вставные группы (is_insert) в сквозной отсчёт НЕ входят: их таймкод — своя
 * шкала от 00:00, а курсор основных групп через них проходит без сдвига.
 */
export async function recomputeEpisodeTimecodes(episodeId: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
  let cursor = 0;
  for (const row of rows) {
    const timecode = row.isInsert
      ? `${fmtTime(0)}–${fmtTime(row.durationSec)}`
      : `${fmtTime(cursor)}–${fmtTime(cursor + row.durationSec)}`;
    if (row.timecode !== timecode) {
      await db.update(shots).set({ timecode }).where(eq(shots.id, row.id));
    }
    if (!row.isInsert) cursor += row.durationSec;
  }
}
