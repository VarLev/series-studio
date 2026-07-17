"use server";

/** Server actions страницы «База правил» (/rules). */
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import {
  deleteUserRuleRow,
  refreshTemplateRulesForKey,
  setRuleEnabled,
  setUserRuleEnabled,
  upsertUserRuleRow,
  TEMPLATE_KEYS,
  type RuleFamily,
  type RuleScope,
} from "@/lib/rules";

type Result = { ok: true } | { ok: false; error: string };

const SCOPES: RuleScope[] = ["all", "breakdown", "video_prompt"];
const FAMILIES: RuleFamily[] = ["all", "seedance", "kling"];

/** Вкл/выкл системного правила или динамического блока реестра. */
export async function toggleRuleState(id: string, enabled: boolean): Promise<Result> {
  await requireAuth();
  try {
    await setRuleEnabled(id, enabled);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
  revalidatePath("/rules");
  return { ok: true };
}

/** Создать/обновить пользовательское правило. */
export async function saveUserRule(input: {
  id?: string;
  title: string;
  text: string;
  scope: RuleScope;
  family: RuleFamily;
  enabled?: boolean;
}): Promise<Result> {
  await requireAuth();
  if (!input.text.trim()) return { ok: false, error: "Текст правила пуст" };
  if (!SCOPES.includes(input.scope) || !FAMILIES.includes(input.family)) {
    return { ok: false, error: "Недопустимая область действия" };
  }
  try {
    await upsertUserRuleRow({
      ...input,
      // family имеет смысл только для видео-промптов
      family: input.scope === "breakdown" ? "all" : input.family,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
  revalidatePath("/rules");
  return { ok: true };
}

export async function toggleUserRule(id: string, enabled: boolean): Promise<Result> {
  await requireAuth();
  try {
    await setUserRuleEnabled(id, enabled);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
  revalidatePath("/rules");
  return { ok: true };
}

export async function deleteUserRule(id: string): Promise<Result> {
  await requireAuth();
  try {
    await deleteUserRuleRow(id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
  revalidatePath("/rules");
  return { ok: true };
}

/**
 * «Обновить из шаблонов»: пересегментировать изменившиеся шаблоны (по sha256).
 * Не изменившиеся пропускаются без вызова модели.
 */
export async function refreshTemplateRules(): Promise<
  | { ok: true; results: Array<{ templateKey: string; skipped: boolean; count: number }> }
  | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const settings = await getAllSettings();
    const results = [];
    for (const key of TEMPLATE_KEYS) {
      const r = await refreshTemplateRulesForKey(key, settings[key]);
      results.push({ templateKey: key, ...r });
    }
    revalidatePath("/rules");
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}
