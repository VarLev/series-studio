import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, entities, references, shots, shotEntities, episodes } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { SectionLabel, EmptyState } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import EntityForm from "@/components/bible/EntityForm";
import RefGallery from "@/components/bible/RefGallery";
import UploadButton from "@/components/UploadButton";

/**
 * Тело карточки сущности без экранной обвязки — общее для полной страницы
 * (/bible/[entityId]) и для правой панели (@panel/(.)bible/[entityId]).
 * Ссылки «участвует в шотах» ведут на экран группы: он не перехвачен, поэтому
 * панель закрывается сама (@panel/[...catchAll] → null), а основной экран
 * уходит на шот — то есть переход из панели в основной экран работает как надо.
 */
export default async function EntityContent({ entityId }: { entityId: string }) {
  await requireAuth();
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
        faceOnly: r.role === "face",
        width: r.width,
        height: r.height,
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

  const t = await getT();

  return (
    <div className="flex flex-col gap-5 p-4 pb-10">
      <div className="flex flex-col gap-2">
        <SectionLabel hint={t("загрузка с камеры или галереи в 1 тап", "one-tap upload from camera or gallery")}>
          {t("Референсы", "References")}
        </SectionLabel>
        <RefGallery refs={galleryRefs} />
        <UploadButton
          kind="reference"
          entityId={entityId}
          label={t("+ Загрузить референсы (фото/кадры)", "+ Upload references (photos/frames)")}
        />
      </div>

      <EntityForm
        entity={{
          id: entity.id,
          type: entity.type,
          name: entity.name,
          elementName: entity.elementName,
          description: entity.description,
          wardrobe: entity.wardrobe,
          soulId: entity.soulId ?? "",
          archived: entity.archived,
        }}
        mainRefId={galleryRefs[0]?.id ?? null}
      />

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("Участвует в шотах", "Appears in shots")}</SectionLabel>
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
                    {t("С", "E")}{String(ep?.number ?? 0).padStart(2, "0")}·{t("Г", "G")}
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
          <EmptyState>{t("Пока не задействован ни в одном шоте.", "Not used in any shot yet.")}</EmptyState>
        )}
      </div>
    </div>
  );
}

/** Имя сущности — для заголовка страницы/панели без повторного запроса тела. */
export async function entityName(entityId: string): Promise<string> {
  const db = await getDb();
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId));
  return entity?.name ?? "";
}
