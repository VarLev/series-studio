/**
 * Маркеры смены шота на таймлайне видео. Снапшот шотов группы снимается в момент
 * постановки задачи генерации и живёт ЗА ВИДЕО (generations.beats_json), а не за
 * группой: последующая правка группы (добавить/убрать шот, сдвинуть тайминг) уже
 * готовые видео не трогает — каждое показывает ту раскадровку, по которой снято.
 *
 * Секунды считаются здесь, на записи: клиенту достаётся готовая шкала, а формат
 * времени шота в shots.beats_json («00:00–00:05») может меняться, не ломая
 * снятые ранее снапшоты.
 *
 * Без серверных зависимостей — модуль импортирует и плеер в браузере.
 */
import { parseTimeRange } from "@/lib/beatsPure";
import { safeParse } from "@/lib/params";
import type { GroupShot } from "@/lib/llm/contracts";

export interface BeatMarker {
  /** номер шота внутри группы (1..N) */
  order: number;
  startSec: number;
  endSec: number;
  framing: string;
  camera: string;
  action: string;
  dialogue: string;
}

/**
 * Снапшот из beats_json группы. Черновые шоты (draft) в видео не входят — их тут
 * нет. Время шотов группы нормализовано от 00:00 (normalizeBeats), поэтому первый
 * маркер всегда 0; курсор-фолбэк — страховка от шота, чей time не распарсился.
 */
export function buildBeatMarkers(beatsJson: string | null | undefined): BeatMarker[] {
  const raw = safeParse<unknown>(beatsJson, []);
  if (!Array.isArray(raw)) return [];
  const beats = (raw as GroupShot[])
    .filter((b) => b && typeof b === "object" && !b.draft)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let cursor = 0;
  return beats.map((b, i) => {
    const range = parseTimeRange(b.time ?? "");
    const startSec = range ? range[0] : cursor;
    const endSec = range ? range[1] : cursor + 1;
    cursor = endSec;
    return {
      order: b.order ?? i + 1,
      startSec,
      endSec,
      framing: b.framing ?? "",
      camera: b.camera ?? "",
      action: b.action ?? "",
      dialogue: b.dialogue ?? "",
    };
  });
}

/**
 * Разбор снапшота из generations.beats_json. null — видео, снятые до появления
 * маркеров: их раскадровка «на момент генерации» неизвестна, маркеров нет.
 */
export function parseBeatMarkers(json: string | null | undefined): BeatMarker[] {
  const raw = safeParse<unknown>(json, []);
  if (!Array.isArray(raw)) return [];
  return (raw as BeatMarker[]).filter(
    (m) => m && typeof m === "object" && Number.isFinite(m.startSec) && Number.isFinite(m.endSec),
  );
}
