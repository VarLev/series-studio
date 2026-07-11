/**
 * Библиотека режиссёрских приёмов: сид из JSFilmz Vault (500 промптов, vault.json),
 * выборка для промпт-фабрики и CRUD-помощники. Сеется при первом обращении.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, settings, techniques } from "@/lib/db";

export interface TechniqueRow {
  id: string;
  title: string;
  category: string;
  camera: string;
  lens: string;
  lighting: string;
  tags: string;
  prompt: string;
  negative: string;
  custom: boolean;
}

let seeded = false;

/** Флаг «сид уже был»: после «удалить все» пустая таблица НЕ пересеивается. */
async function markSeeded(): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key: "techniques_seeded", value: "1" })
    .onConflictDoNothing();
}

/** Первый запуск: заливаем вольт в БД (после — только пользовательские правки). */
export async function ensureTechniques(): Promise<void> {
  if (seeded) return;
  const db = await getDb();
  const [flag] = await db.select().from(settings).where(eq(settings.key, "techniques_seeded"));
  if (flag) {
    seeded = true;
    return;
  }
  const [first] = await db.select().from(techniques).limit(1);
  if (first) {
    seeded = true;
    await markSeeded();
    return;
  }
  const { default: vault } = (await import("./director/vault.json")) as {
    default: Array<Omit<TechniqueRow, "custom">>;
  };
  // пакетами — 500 одиночных insert'ов в PGlite заметно медленнее;
  // onConflictDoNothing: два параллельных запроса могут сеять одновременно
  for (let i = 0; i < vault.length; i += 50) {
    await db
      .insert(techniques)
      .values(vault.slice(i, i + 50).map((t) => ({ ...t, custom: false })))
      .onConflictDoNothing();
  }
  seeded = true;
  await markSeeded();
}

/** Очистить библиотеку целиком (замечание заказчика: «удали пока все приёмы»). */
export async function deleteAllTechniqueRows(): Promise<void> {
  const db = await getDb();
  await db.delete(techniques);
  await markSeeded(); // пустая библиотека не пересеивается вольтом
  seeded = true;
}

export async function listTechniques(): Promise<TechniqueRow[]> {
  await ensureTechniques();
  const db = await getDb();
  const rows = await db.select().from(techniques).orderBy(asc(techniques.category), asc(techniques.title));
  return rows;
}

export async function getTechniquesByIds(ids: string[]): Promise<TechniqueRow[]> {
  if (!ids.length) return [];
  const all = await listTechniques();
  const byId = new Map(all.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is TechniqueRow => Boolean(t));
}

/** Компактный индекс для LLM-подбора (id · название · камера · теги · категория). */
export function techniqueIndex(rows: TechniqueRow[]): string {
  return rows
    .map((t) => `${t.id} | ${t.title} | ${t.camera}${t.lens ? ` · ${t.lens}` : ""} | ${t.tags} | ${t.category}`)
    .join("\n");
}

export async function upsertTechniqueRow(input: {
  id?: string;
  title: string;
  category: string;
  prompt: string;
  negative: string;
  camera?: string;
  lens?: string;
  lighting?: string;
  tags?: string;
}): Promise<string> {
  await ensureTechniques();
  const db = await getDb();
  const id = input.id ?? crypto.randomUUID();
  await db
    .insert(techniques)
    .values({
      id,
      title: input.title,
      category: input.category,
      camera: input.camera ?? "",
      lens: input.lens ?? "",
      lighting: input.lighting ?? "",
      tags: input.tags ?? "",
      prompt: input.prompt,
      negative: input.negative,
      custom: !input.id, // новые карточки — пользовательские
    })
    .onConflictDoUpdate({
      target: techniques.id,
      set: {
        title: input.title,
        category: input.category,
        camera: input.camera ?? "",
        lens: input.lens ?? "",
        lighting: input.lighting ?? "",
        tags: input.tags ?? "",
        prompt: input.prompt,
        negative: input.negative,
      },
    });
  return id;
}

export async function deleteTechniqueRow(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(techniques).where(eq(techniques.id, id));
}
