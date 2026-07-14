/**
 * Список видео эпизода для экспорта (ZIP и CapCut). Порядок — как в серии: по
 * позиции шота (order_index), внутри шота — по времени создания. Нумерация n
 * сквозная по эпизоду (заказчик: «номер видео по времени очередности, сначала
 * ранние, потом поздние»). scope="all" — все готовые видео (каждая попытка);
 * "winners" — только победители (для старой «скачать всё» в галерее).
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, episodes, generations, shots } from "@/lib/db";

export interface ExportVideo {
  genId: string;
  shotId: string;
  storagePath: string;
  ext: string; // ".mp4" | ".webm" | ".mov"
  n: number; // сквозной 1-based номер в эпизоде
}

export interface EpisodeExport {
  episode: { id: string; number: number; title: string };
  videos: ExportVideo[];
}

export async function getEpisodeExport(
  episodeId: string,
  scope: "all" | "winners" = "all",
): Promise<EpisodeExport | null> {
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) return null;
  const shotRows = await db
    .select({ id: shots.id, orderIndex: shots.orderIndex })
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
  const info = { id: episode.id, number: episode.number, title: episode.title };
  if (!shotRows.length) return { episode: info, videos: [] };
  const orderByShot = new Map(shotRows.map((s) => [s.id, s.orderIndex]));

  const conds = [
    eq(generations.kind, "video"),
    eq(generations.status, "done"),
    isNotNull(generations.resultStoragePath),
    inArray(generations.shotId, shotRows.map((s) => s.id)),
  ];
  if (scope === "winners") conds.push(eq(generations.winner, true));
  const gens = await db
    .select({
      id: generations.id,
      shotId: generations.shotId,
      resultStoragePath: generations.resultStoragePath,
      createdAt: generations.createdAt,
    })
    .from(generations)
    .where(and(...conds));

  const ordered = gens
    .filter((g): g is typeof g & { shotId: string; resultStoragePath: string } =>
      Boolean(g.shotId && g.resultStoragePath),
    )
    .sort((a, b) => {
      const ao = orderByShot.get(a.shotId) ?? 0;
      const bo = orderByShot.get(b.shotId) ?? 0;
      return ao - bo || a.createdAt.getTime() - b.createdAt.getTime();
    });

  const videos: ExportVideo[] = ordered.map((g, i) => ({
    genId: g.id,
    shotId: g.shotId,
    storagePath: g.resultStoragePath,
    ext: (g.resultStoragePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4").toLowerCase(),
    n: i + 1,
  }));
  return { episode: info, videos };
}
