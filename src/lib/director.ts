/**
 * Библиотека режиссёрских приёмов: сид — кураторская выборка заказчика из
 * JSFilmz Vault под Seedance 2.0 (46 промптов, vault2.json; полный вольт на
 * 500 карточек лежит рядом в vault.json на будущее). CRUD-помощники и выборка
 * для промпт-фабрики. Сеется при первом обращении.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, settings, techniques } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";

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

// Версия заводского вольта. Бампится, когда переписываем библиотеку (напр.
// чистка зашитой мизансцены 2026-07-13) — тогда на первом обращении заводские
// карточки пересеиваются в уже существующих БД, а не остаются старыми.
const SEED_VERSION = "2";
let ensured = false;

/** Запомнить версию сида (после «удалить все» — тоже: чтобы не пересеять). */
async function setSeedVersion(value: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key: "techniques_seed_version", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * Сид/пересид заводской библиотеки. При смене SEED_VERSION пересеиваем ТОЛЬКО
 * заводские карточки (custom=false): удаляем старые и заливаем актуальный вольт;
 * пользовательские приёмы (custom=true) НЕ трогаем. «Удалить все» ставит текущую
 * версию — очищенная библиотека не воскресает.
 */
export async function ensureTechniques(): Promise<void> {
  if (ensured) return;
  const db = await getDb();
  const [ver] = await db.select().from(settings).where(eq(settings.key, "techniques_seed_version"));
  if (ver?.value === SEED_VERSION) {
    ensured = true;
    return;
  }
  const { default: vault } = (await import("./director/vault2.json")) as {
    default: Array<Omit<TechniqueRow, "custom">>;
  };
  // заводские карточки заменяем на актуальный вольт; при первом запуске delete — no-op
  await db.delete(techniques).where(eq(techniques.custom, false));
  // пакетами — одиночные insert'ы в PGlite заметно медленнее;
  // onConflictDoNothing: два параллельных запроса могут сеять одновременно
  for (let i = 0; i < vault.length; i += 50) {
    await db
      .insert(techniques)
      .values(vault.slice(i, i + 50).map((t) => ({ ...t, custom: false })))
      .onConflictDoNothing();
  }
  await setSeedVersion(SEED_VERSION);
  ensured = true;
}

/** Очистить библиотеку целиком (замечание заказчика: «удали пока все приёмы»). */
export async function deleteAllTechniqueRows(): Promise<void> {
  const db = await getDb();
  await db.delete(techniques);
  await setSeedVersion(SEED_VERSION); // очищенная библиотека не пересеивается вольтом
  ensured = true;
}

/** ВСЕ приёмы — для библиотеки на вкладке «База знаний» (она видна и выключенной). */
export async function listTechniques(): Promise<TechniqueRow[]> {
  await ensureTechniques();
  const db = await getDb();
  const rows = await db.select().from(techniques).orderBy(asc(techniques.category), asc(techniques.title));
  return rows;
}

/** Включена ли библиотека приёмов целиком (выключатель на вкладке «База знаний»). */
export async function techniquesEnabled(): Promise<boolean> {
  return (await getAllSettings()).techniques_enabled !== "0";
}

/**
 * Приёмы, которым разрешено доехать до модели. Всё, что кормит LLM или предлагает
 * приём пользователю (индекс Enhance, пикер на карточке шота, валидация ответа
 * Enhance), обязано ходить сюда: библиотека выключена — приёмы не уходят совсем.
 */
export async function listEnabledTechniques(): Promise<TechniqueRow[]> {
  if (!(await techniquesEnabled())) return [];
  return listTechniques();
}

/** Поиск по id среди ВСЕХ приёмов — для показа истории (бейджи 🎥 прошлых версий). */
export async function getTechniquesByIds(ids: string[]): Promise<TechniqueRow[]> {
  if (!ids.length) return [];
  const all = await listTechniques();
  const byId = new Map(all.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is TechniqueRow => Boolean(t));
}

/** То же, но пусто при выключенной библиотеке — что реально можно вплести в промпт. */
export async function getEnabledTechniquesByIds(ids: string[]): Promise<TechniqueRow[]> {
  if (!(await techniquesEnabled())) return [];
  return getTechniquesByIds(ids);
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
