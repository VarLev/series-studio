import { asc, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, entities, references } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { ScreenHeader } from "@/components/ui";
import BibleList from "@/components/bible/BibleList";

export const dynamic = "force-dynamic";

export default async function BiblePage() {
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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/episodes" eyebrow="Весь сериал" title="Библия сущностей" />
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
    </main>
  );
}
