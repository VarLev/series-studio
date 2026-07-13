/**
 * Привязка сущностей библии к группе шотов: явный список имён от модели +
 * скан текста шотов по границам слов (подхватывает персонажей, которых модель
 * забыла внести в characters[] — «Craig в тени») + якорь одежды из wardrobe[].
 * Общая для раскадровки (saveBreakdown) и вставных групп (insertShotGroups).
 */
import { and, eq } from "drizzle-orm";
import { getDb, entities, shotEntities } from "@/lib/db";
import { stripAt } from "@/lib/entityName";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface EntityLinkIndex {
  /** name/element_name (без @, без регистра) → id сущности */
  byName: Map<string, string>;
  /** регэкспы по границам слов для скана текста битов */
  scanIndex: Array<{ id: string; re: RegExp }>;
}

/** Индекс строится один раз на всю пачку групп (не на каждую). */
export async function buildEntityLinkIndex(): Promise<EntityLinkIndex> {
  const db = await getDb();
  const allEntities = await db.select().from(entities);
  const byName = new Map<string, string>();
  for (const e of allEntities) {
    byName.set(stripAt(e.elementName), e.id);
    byName.set(stripAt(e.name), e.id);
  }
  const scanIndex = allEntities
    .flatMap((e) => [
      { key: stripAt(e.name), id: e.id },
      { key: stripAt(e.elementName), id: e.id },
    ])
    .filter((x) => x.key.length >= 2)
    .map((x) => ({
      id: x.id,
      re: new RegExp(`(^|[^\\wа-яё])${escapeRe(x.key)}([^\\wа-яё]|$)`, "i"),
    }));
  return { byName, scanIndex };
}

/** Привязать сущности к одной группе: имена + скан текста + сценарный гардероб. */
export async function linkGroupEntities(
  index: EntityLinkIndex,
  shotId: string,
  input: {
    /** явные имена от модели (персонажи группы, локация) */
    names: string[];
    /** склеенный текст шотов группы (framing/camera/action/dialogue) */
    beatsText: string;
    wardrobe?: Array<{ name: string; outfit: string }>;
  },
): Promise<void> {
  const db = await getDb();
  const linked = new Set<string>();
  for (const name of input.names) {
    const entityId = index.byName.get(stripAt(name));
    if (entityId) linked.add(entityId);
  }
  for (const { id, re } of index.scanIndex) {
    if (re.test(input.beatsText)) linked.add(id);
  }
  for (const entityId of linked) {
    await db.insert(shotEntities).values({ shotId, entityId, auto: true }).onConflictDoNothing();
  }
  // якорь одежды: наряд пишем ТОЛЬКО когда сюжет/запрос описал его для сцены
  // (иначе по умолчанию берётся базовый гардероб из библии). Источник "generated" —
  // чтобы сценарный наряд ушёл в промпт вместо библейского.
  for (const w of input.wardrobe ?? []) {
    const entityId = index.byName.get(stripAt(w.name));
    if (!entityId || !w.outfit.trim()) continue;
    await db
      .update(shotEntities)
      .set({ outfit: w.outfit.trim(), outfitSource: "generated" })
      .where(and(eq(shotEntities.shotId, shotId), eq(shotEntities.entityId, entityId)));
  }
}
