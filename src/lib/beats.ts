/**
 * Серверная часть тайминга: сквозной таймкод эпизода. Вся чистая логика
 * (normalizeBeats, парсинг времени, связки сцен, номера групп) живёт в
 * lib/beatsPure — без серверных импортов, чтобы её мог использовать и
 * предпросмотр разбивки в браузере. Реэкспорт ниже сохраняет старые импорты
 * из "@/lib/beats" рабочими.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, shots } from "@/lib/db";
import { fmtTime } from "@/lib/beatsPure";

export * from "@/lib/beatsPure";

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
