import { asc, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, entities, references } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import BibleList from "@/components/bible/BibleList";

/**
 * Тело раздела «Библия» без экранной обвязки — общее для полной страницы
 * (/bible, прямой URL) и для правой панели (@panel/(.)bible). Свою шапку не
 * рисует: её даёт либо ScreenHeader страницы, либо заголовок слайдера.
 */
export default async function BibleContent() {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(entities).orderBy(asc(entities.name));
  const refs = rows.length
    ? await db.select().from(references).where(inArray(references.entityId, rows.map((e) => e.id)))
    : [];
  const avatarByEntity = new Map<string, string>();
  const refCount = new Map<string, number>();
  for (const ref of refs) {
    if (!ref.entityId || ref.shotId) continue;
    refCount.set(ref.entityId, (refCount.get(ref.entityId) ?? 0) + 1);
    if (!avatarByEntity.has(ref.entityId)) {
      avatarByEntity.set(ref.entityId, await getFileUrl(ref.storagePath));
    }
  }

  return (
    <BibleList
      items={rows.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        elementName: e.elementName,
        archived: e.archived,
        avatarUrl: avatarByEntity.get(e.id) ?? null,
        refCount: refCount.get(e.id) ?? 0,
      }))}
    />
  );
}
