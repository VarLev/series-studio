/**
 * Каскадные удаления: единственное место, где объект «выкорчёвывается» со всеми
 * ссылками на него. Инцидент 2026-07-12: референсы в библии удалили и заменили,
 * а в модель ушли СТАРЫЕ изображения — потому что кэши провайдера в settings
 * (hf_elem2_{entityId}, hf_media3_{provider}_{refId}) никем не сбрасывались.
 * Любое удаление референса/сущности/шота обязано проходить через эти функции.
 */
import { eq, like, or, type SQL } from "drizzle-orm";
import {
  getDb,
  generations,
  prompts,
  references,
  settings,
  shotEntities,
  shots,
} from "@/lib/db";
import { deleteFile } from "@/lib/storage";

/** Удалить файл в хранилище, только если на него не ссылается другая запись references/generations. */
export async function maybeDeleteBlob(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const db = await getDb();
  const refUses = await db.select().from(references).where(eq(references.storagePath, storagePath));
  const genUses = await db
    .select()
    .from(generations)
    .where(eq(generations.resultStoragePath, storagePath));
  if (refUses.length === 0 && genUses.length === 0) await deleteFile(storagePath).catch(() => {});
}

/**
 * Сброс кэшей провайдеров при удалении референсов/сущностей:
 *  - hf_media3_{provider}_{refId} — загруженное медиа референса у провайдера;
 *  - hf_elem2_{entityId} — именованный reference element Higgsfield, созданный
 *    из ПЕРВОГО референса сущности. Если референсы сущности меняются (удаление,
 *    замена фото), элемент обязан пересоздаться — иначе в генерацию уходит
 *    старое изображение.
 */
export async function invalidateProviderCaches(opts: {
  refIds?: string[];
  entityIds?: string[];
}): Promise<void> {
  const conds: SQL[] = [];
  for (const refId of opts.refIds ?? []) {
    if (refId) conds.push(like(settings.key, `hf_media3_%${refId}`));
  }
  for (const entityId of opts.entityIds ?? []) {
    if (entityId) conds.push(eq(settings.key, `hf_elem2_${entityId}`));
  }
  if (!conds.length) return;
  const db = await getDb();
  await db.delete(settings).where(or(...conds));
}

/**
 * Глубокое удаление шота: генерации (+файлы результатов), референсы шота
 * (+файлы и кэши провайдера), промпты, связки с сущностями, отвязка листов
 * раскадровки (sb_shot_id) и сама строка шота.
 */
export async function deleteShotDeep(shotId: string): Promise<void> {
  const db = await getDb();
  const gens = await db.select().from(generations).where(eq(generations.shotId, shotId));
  for (const g of gens) {
    await db.delete(generations).where(eq(generations.id, g.id));
    await maybeDeleteBlob(g.resultStoragePath);
  }
  const shotRefs = await db.select().from(references).where(eq(references.shotId, shotId));
  for (const r of shotRefs) {
    await db.delete(references).where(eq(references.id, r.id));
    await maybeDeleteBlob(r.storagePath);
  }
  await invalidateProviderCaches({ refIds: shotRefs.map((r) => r.id) });
  // листы раскадровки, привязанные к шоту, остаются референсами серии — но без
  // ссылки на несуществующий шот
  await db.update(references).set({ sbShotId: null }).where(eq(references.sbShotId, shotId));
  await db.delete(prompts).where(eq(prompts.shotId, shotId));
  await db.delete(shotEntities).where(eq(shotEntities.shotId, shotId));
  await db.delete(shots).where(eq(shots.id, shotId));
}
