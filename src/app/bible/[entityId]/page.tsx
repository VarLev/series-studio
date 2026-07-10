import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, entities, references, shots, shotEntities, episodes } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { ScreenHeader, SectionLabel, EmptyState } from "@/components/ui";
import EntityForm from "@/components/bible/EntityForm";
import RefGallery from "@/components/bible/RefGallery";
import UploadButton from "@/components/UploadButton";

export const dynamic = "force-dynamic";

export default async function EntityPage(ctx: { params: Promise<{ entityId: string }> }) {
  await requireAuth();
  const { entityId } = await ctx.params;
  const db = await getDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) notFound();

  const refRows = await db
    .select()
    .from(references)
    .where(eq(references.entityId, entityId))
    .orderBy(asc(references.createdAt));
  const galleryRefs = await Promise.all(
    refRows
      .filter((r) => !r.shotId)
      .map(async (r) => ({
        id: r.id,
        url: await getFileUrl(r.storagePath),
        caption: r.caption,
        source: r.source,
      })),
  );

  // где участвует
  const links = await db.select().from(shotEntities).where(eq(shotEntities.entityId, entityId));
  const shotRows = links.length
    ? await db.select().from(shots).where(inArray(shots.id, links.map((l) => l.shotId)))
    : [];
  const epIds = [...new Set(shotRows.map((s) => s.episodeId))];
  const epRows = epIds.length
    ? await db.select().from(episodes).where(inArray(episodes.id, epIds))
    : [];
  const epById = new Map(epRows.map((e) => [e.id, e]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/bible" eyebrow="Библия" title={entity.name} />
      <div className="flex flex-col gap-5 p-4 pb-10">
        <div className="flex flex-col gap-2">
          <SectionLabel hint="загрузка с камеры или галереи в 1 тап">Референсы</SectionLabel>
          <RefGallery refs={galleryRefs} />
          <UploadButton
            kind="reference"
            entityId={entityId}
            label="+ Загрузить референсы (фото/кадры)"
          />
        </div>

        <EntityForm
          entity={{
            id: entity.id,
            type: entity.type,
            name: entity.name,
            elementName: entity.elementName,
            description: entity.description,
            soulId: entity.soulId ?? "",
            archived: entity.archived,
          }}
        />

        <div className="flex flex-col gap-2">
          <SectionLabel>Участвует в шотах</SectionLabel>
          {shotRows.length ? (
            <div className="flex flex-col gap-1.5">
              {shotRows.map((s) => {
                const ep = epById.get(s.episodeId);
                return (
                  <Link
                    key={s.id}
                    href={`/episodes/${s.episodeId}/shots/${s.id}`}
                    className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 hover:border-[var(--border-strong)]"
                  >
                    <span className="font-mono text-[10px] font-semibold text-t400">
                      С{String(ep?.number ?? 0).padStart(2, "0")}·Г
                      {String(s.orderIndex).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-t200">
                      {s.title || s.actionMd.slice(0, 50)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState>Пока не задействован ни в одном шоте.</EmptyState>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-[var(--border-default)] p-3 text-[11px] leading-relaxed text-t400">
          «Обучить Soul-персонажа» из референсов — Этап 3 (Higgsfield Soul ID).
        </div>
      </div>
    </main>
  );
}
