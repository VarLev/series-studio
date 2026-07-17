/**
 * «База правил» (/rules) — серверные помощники:
 *  - вкл/выкл системных правил и динамических блоков (settings.rules_disabled);
 *  - CRUD пользовательских правил (prompt_rules) и их вклейка в system-промпты
 *    (customRulesContext) высокоприоритетным блоком;
 *  - сегментация редактируемых шаблонов в read-only правила (template_rules)
 *    с хэшем-меткой актуальности.
 */
import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, promptRules, settings, templateRules } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { ALL_TOGGLEABLE_IDS, type RuleSite } from "@/lib/llm/rulesRegistry";

// ---------- вкл/выкл записей реестра (системные правила + динамические блоки) ----------

/** Выключенные id реестра из settings.rules_disabled (мусор игнорируется). */
export async function getDisabledRuleIds(): Promise<Set<string>> {
  const raw = (await getAllSettings()).rules_disabled;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {}
  return new Set();
}

/**
 * Включить/выключить запись реестра. Неизвестные id отвергаются.
 *
 * Весь цикл «прочитал список → поправил → записал» идёт ОДНОЙ транзакцией с
 * блокировкой строки: без неё два таба, гасящие РАЗНЫЕ правила, читали один и тот
 * же массив и последний писал поверх — чужой тумблер молча воскресал.
 */
export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  if (!ALL_TOGGLEABLE_IDS.has(id)) throw new Error(`Неизвестное правило: ${id}`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    // строку сначала гарантируем: на чистой БД ключа нет и блокировать нечего
    await tx
      .insert(settings)
      .values({ key: "rules_disabled", value: "[]" })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(settings)
      .where(eq(settings.key, "rules_disabled"))
      .for("update");
    let list: string[] = [];
    try {
      const parsed = JSON.parse(row?.value ?? "[]");
      if (Array.isArray(parsed)) list = parsed.filter((v): v is string => typeof v === "string");
    } catch {}
    const set = new Set(list);
    if (enabled) set.delete(id);
    else set.add(id);
    await tx
      .update(settings)
      .set({ value: JSON.stringify([...set]) })
      .where(eq(settings.key, "rules_disabled"));
  });
}

// ---------- пользовательские правила (prompt_rules) ----------

export type UserRule = typeof promptRules.$inferSelect;
export type RuleScope = "all" | "breakdown" | "video_prompt";
export type RuleFamily = "all" | "seedance" | "kling";

export async function listUserRules(): Promise<UserRule[]> {
  const db = await getDb();
  return db
    .select()
    .from(promptRules)
    .orderBy(asc(promptRules.sortIndex), asc(promptRules.createdAt));
}

export async function upsertUserRuleRow(input: {
  id?: string;
  title: string;
  text: string;
  scope: RuleScope;
  family: RuleFamily;
  enabled?: boolean;
}): Promise<string> {
  const db = await getDb();
  const id = input.id ?? crypto.randomUUID();
  const values = {
    id,
    title: input.title,
    text: input.text,
    scope: input.scope,
    family: input.family,
    enabled: input.enabled ?? true,
  };
  await db
    .insert(promptRules)
    .values(values)
    .onConflictDoUpdate({
      target: promptRules.id,
      set: {
        title: values.title,
        text: values.text,
        scope: values.scope,
        family: values.family,
        enabled: values.enabled,
      },
    });
  return id;
}

export async function setUserRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.update(promptRules).set({ enabled }).where(eq(promptRules.id, id));
}

export async function deleteUserRuleRow(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(promptRules).where(eq(promptRules.id, id));
}

/**
 * Блок пользовательских правил для system-промпта вызова: активные правила,
 * отфильтрованные по области действия (и треку для видео-промптов). Пусто,
 * если подходящих правил нет.
 */
export async function customRulesContext(
  site: RuleSite,
  family?: "seedance" | "kling",
): Promise<string> {
  const rows = await listUserRules();
  const isVideoSite = site === "shot_prompt_seedance" || site === "shot_prompt_kling" || site === "revise_prompt";
  const wantScope: RuleScope = isVideoSite ? "video_prompt" : "breakdown";
  const fam = family ?? (site === "shot_prompt_kling" ? "kling" : site === "shot_prompt_seedance" ? "seedance" : undefined);
  const relevant = rows.filter((r) => {
    if (!r.enabled || !r.text.trim()) return false;
    if (r.scope !== "all" && r.scope !== wantScope) return false;
    // family-специфичные правила действуют только на видео-вызовы своего трека;
    // в breakdown-вызовы попадают лишь правила family=all
    if (isVideoSite) return r.family === "all" || (fam ? r.family === fam : false);
    return r.family === "all";
  });
  if (!relevant.length) return "";
  return (
    "ПОЛЬЗОВАТЕЛЬСКИЕ ПРАВИЛА (заданы владельцем сериала — ПРИОРИТЕТНЕЕ общих инструкций выше; " +
    "при конфликте следуй им; формат ответа JSON это НЕ меняет):\n" +
    relevant
      .map((r) => `- ${r.title.trim() ? `${r.title.trim()}: ` : ""}${r.text.trim()}`)
      .join("\n")
  );
}

// ---------- правила из шаблонов (template_rules) ----------

export type TemplateKey = "tpl_breakdown" | "tpl_video" | "tpl_video_kling";
export const TEMPLATE_KEYS: TemplateKey[] = ["tpl_breakdown", "tpl_video", "tpl_video_kling"];
export type TemplateRuleRow = typeof templateRules.$inferSelect;

export function templateHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function listTemplateRules(): Promise<TemplateRuleRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(templateRules)
    .orderBy(asc(templateRules.templateKey), asc(templateRules.orderIndex));
}

/** Состояние витрины по каждому шаблону: сколько правил и не устарели ли они. */
export async function templateRulesStatus(): Promise<
  Array<{ templateKey: TemplateKey; count: number; stale: boolean; empty: boolean }>
> {
  const settings = await getAllSettings();
  const rows = await listTemplateRules();
  return TEMPLATE_KEYS.map((key) => {
    const own = rows.filter((r) => r.templateKey === key);
    const currentHash = templateHash(settings[key]);
    return {
      templateKey: key,
      count: own.length,
      empty: own.length === 0,
      stale: own.length > 0 && own.some((r) => r.sourceHash !== currentHash),
    };
  });
}

/**
 * Пересегментировать один шаблон, если он изменился с прошлого раза
 * (по sha256). Совпал — skip без вызова модели.
 */
export async function refreshTemplateRulesForKey(
  key: TemplateKey,
  current: string,
): Promise<{ skipped: boolean; count: number }> {
  const db = await getDb();
  const hash = templateHash(current);
  const existing = await db.select().from(templateRules).where(eq(templateRules.templateKey, key));
  if (existing.length && existing.every((r) => r.sourceHash === hash)) {
    return { skipped: true, count: existing.length };
  }
  const { llmSegmentTemplate } = await import("@/lib/llm/factory");
  const seg = await llmSegmentTemplate(current);
  const rows = seg.rules
    .filter((r) => r.text.trim())
    .map((r, i) => ({
      id: crypto.randomUUID(),
      templateKey: key,
      orderIndex: i,
      title: r.title.trim(),
      text: r.text,
      sourceHash: hash,
    }));
  // Заменяем витрину целиком: сначала успешная сегментация, потом delete+insert —
  // и то и другое ОДНОЙ транзакцией. Порознь падение между ними теряло правила
  // шаблона насовсем, а два параллельных refresh задваивали строки (после чего
  // хэши совпадали и «нет изменений» держалось до следующей правки шаблона).
  return db.transaction(async (tx) => {
    const fresh = await tx
      .select()
      .from(templateRules)
      .where(eq(templateRules.templateKey, key))
      .for("update");
    // пока ходили в модель, соседний refresh мог разложить ТОТ ЖЕ текст — не дублим
    if (fresh.length && fresh.every((r) => r.sourceHash === hash)) {
      return { skipped: true, count: fresh.length };
    }
    await tx.delete(templateRules).where(eq(templateRules.templateKey, key));
    if (rows.length) await tx.insert(templateRules).values(rows);
    return { skipped: false, count: rows.length };
  });
}
