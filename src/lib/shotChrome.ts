import { cache } from "react";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, episodes, generations, references, shots } from "@/lib/db";
import { getFileUrls } from "@/lib/storage";
import { thumbForResult } from "@/lib/poster";
import { displayGroupNumbers } from "@/lib/beats";
import type { StripShot } from "@/components/FilmStrip";

/**
 * Общее для ВСЕЙ серии на экране группы шотов: кинолента, master-колонка, шапка.
 * Живёт в shots/(card)/layout.tsx — сегментом выше меняющегося [shotId], поэтому
 * при переходе между группами не перезапрашивается (см. layout.md: «Layouts are
 * cached in the client during navigation… Layouts do not rerender»).
 *
 * cache() дедуплицирует вызовы в пределах одного рендера: шапка, кинолента и
 * master-колонка — три разных Suspense-границы, но запрос уходит один.
 */

/** Узкие строки шотов серии: всё, что нужно и layout'у, и детальной странице. */
export const getEpisodeShotRows = cache(async (episodeId: string) => {
  const db = await getDb();
  return db
    .select({
      id: shots.id,
      orderIndex: shots.orderIndex,
      title: shots.title,
      actionMd: shots.actionMd,
      status: shots.status,
      location: shots.location,
      timeWeather: shots.timeWeather,
      sceneStart: shots.sceneStart,
      isInsert: shots.isInsert,
    })
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
});

export type ChromeShotRow = Awaited<ReturnType<typeof getEpisodeShotRows>>[number];

/** Шот в шапке/master-колонке: без миниатюр — их ждёт только кинолента. */
export interface NavShot {
  id: string;
  displayNo: number;
  isInsert: boolean;
  status: string;
  title: string;
  /** первые 30 символов фрагмента сюжета — подпись, если у группы нет названия */
  actionSnippet: string;
  sceneStart: boolean;
}

/** Номер группы в серии: вставные группы (isInsert) в нумерацию не входят. */
export const getShotNav = cache(async (episodeId: string) => {
  const rows = await getEpisodeShotRows(episodeId);
  const displayNoById = displayGroupNumbers(rows);
  const navShots: NavShot[] = rows.map((s, i) => ({
    id: s.id,
    displayNo: displayNoById.get(s.id) ?? 0,
    isInsert: s.isInsert,
    status: s.status,
    title: s.title,
    actionSnippet: s.actionMd.slice(0, 30),
    // первая группа серии — всегда начало сцены
    sceneStart: i === 0 || s.sceneStart,
  }));
  return navShots;
});

/** Номер серии для eyebrow шапки («Серия 03 · Группа 07»). */
export const getEpisodeNumber = cache(async (episodeId: string) => {
  const db = await getDb();
  const [episode] = await db
    .select({ number: episodes.number })
    .from(episodes)
    .where(eq(episodes.id, episodeId));
  return episode?.number ?? 0;
});

/**
 * Миниатюры киноленты. Самая дорогая часть экрана: батч подписанных URL +
 * проверка постера в хранилище на каждую группу (I/O по числу групп). Раньше
 * это крутилось в [shotId]/page.tsx — то есть на КАЖДОМ переключении группы,
 * хотя кинолента не меняется.
 */
export const getStripShots = cache(async (episodeId: string): Promise<StripShot[]> => {
  const db = await getDb();
  const rows = await getEpisodeShotRows(episodeId);
  const nav = await getShotNav(episodeId);
  const displayNoById = new Map(nav.map((n) => [n.id, n.displayNo]));
  const shotIds = rows.map((s) => s.id);

  // референс-миниатюра шота (фолбэк, если готового видео ещё нет): по одному рефу
  // на шот (start_frame вперёд), URL'ы — одним батчем (getFileUrls), а не циклом
  // последовательных подписей. valid-компаратор: битый однорукий давал случайный
  // порядок — миниатюрой мог стать не start_frame.
  const shotRefsAll = shotIds.length
    ? await db
        .select({
          shotId: references.shotId,
          storagePath: references.storagePath,
          role: references.role,
        })
        .from(references)
        .where(inArray(references.shotId, shotIds))
    : [];
  const thumbRefByShot = new Map<string, string>(); // shotId → storage_path
  for (const ref of shotRefsAll
    .slice()
    .sort((a, b) => (a.role === "start_frame" ? -1 : 0) - (b.role === "start_frame" ? -1 : 0))) {
    if (ref.shotId && !thumbRefByShot.has(ref.shotId)) {
      thumbRefByShot.set(ref.shotId, ref.storagePath);
    }
  }
  const thumbEntries = [...thumbRefByShot.entries()];
  const thumbUrls = await getFileUrls(thumbEntries.map(([, p]) => p));
  const thumbByShot = new Map<string, string>(
    thumbEntries.map(([shotId], i) => [shotId, thumbUrls[i]]),
  );

  // основная миниатюра киноленты = кадр ФАКТИЧЕСКОГО видео: последний утверждённый
  // (★), иначе первый готовый результат (совпадает с логикой списка шотов серии).
  // узкие колонки (не тянем килобайтные params_json) + фильтр «готовый результат» в SQL
  const stripGens = shotIds.length
    ? await db
        .select({
          shotId: generations.shotId,
          winner: generations.winner,
          createdAt: generations.createdAt,
          resultStoragePath: generations.resultStoragePath,
        })
        .from(generations)
        .where(
          and(
            inArray(generations.shotId, shotIds),
            eq(generations.status, "done"),
            isNotNull(generations.resultStoragePath),
          ),
        )
    : [];
  // миниатюра киноленты: постер-jpg видео, если есть рядом, иначе само видео
  const videoThumbByShot = new Map<string, { url: string; isVideo: boolean }>();
  for (const s of rows) {
    const arr = stripGens
      .filter((g) => g.shotId === s.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!arr.length) continue;
    const winners = arr.filter((g) => g.winner);
    const best = winners.length ? winners[winners.length - 1] : arr[0];
    videoThumbByShot.set(s.id, await thumbForResult(best.resultStoragePath!));
  }

  return rows.map((s, i) => {
    const vt = videoThumbByShot.get(s.id);
    return {
      id: s.id,
      orderIndex: s.orderIndex,
      displayNo: displayNoById.get(s.id) ?? 0,
      isInsert: s.isInsert,
      status: s.status,
      // сперва кадр видео, иначе референс шота
      thumbUrl: vt?.url ?? thumbByShot.get(s.id) ?? null,
      thumbIsVideo: vt?.isVideo ?? false,
      sceneStart: i === 0 || s.sceneStart,
    };
  });
});
