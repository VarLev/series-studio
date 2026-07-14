import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, generations, references } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { availableImageModels } from "@/lib/generation";
import GenPoller from "@/components/GenPoller";
import SeriesRefs from "@/components/refs/SeriesRefs";

/**
 * Содержимое экрана «Референсы серии» без обёртки страницы — используется и
 * полной страницей (прямой URL), и правым слайдером (intercepting-роут
 * @drawer/(.)refs) на экране эпизода.
 */
export default async function RefsContent({ episodeId }: { episodeId: string }) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(references)
    .where(
      and(eq(references.episodeId, episodeId), isNull(references.shotId), isNull(references.entityId)),
    )
    .orderBy(asc(references.createdAt));

  const refs = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      token: r.token ?? "",
      caption: r.caption,
      source: r.source,
      width: r.width,
      height: r.height,
      // анализ изображения (JSON {description,camera}) — детальный просмотр
      analysis: r.analysis ?? "",
    })),
  );

  // активные задачи-референсы этой серии — пульсирующие плейсхолдеры в сетке
  const activeJobs = (
    await db
      .select()
      .from(generations)
      .where(and(eq(generations.kind, "reference"), inArray(generations.status, ["queued", "running"])))
      .orderBy(desc(generations.createdAt))
  ).filter((g) => g.episodeId === episodeId);

  return (
    <>
      <GenPoller activeCount={activeJobs.length} />
      <SeriesRefs
        episodeId={episodeId}
        refs={refs}
        pendingJobs={activeJobs.map((g) => ({ id: g.id, model: g.model }))}
        imageModels={await availableImageModels()}
      />
    </>
  );
}
