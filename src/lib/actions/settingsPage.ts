"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, settings } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { DEFAULT_SETTINGS, setSetting } from "@/lib/settings";
import { upsertTechniqueRow, deleteTechniqueRow, deleteAllTechniqueRows } from "@/lib/director";

type Result = { ok: true } | { ok: false; error: string };

/** Сохранить шаблон промпта (tpl_breakdown | tpl_storyboard | tpl_video | tpl_video_kling). */
export async function saveTemplate(
  key: "tpl_breakdown" | "tpl_storyboard" | "tpl_video" | "tpl_video_kling",
  value: string,
): Promise<Result> {
  await requireAuth();
  if (!value.trim()) return { ok: false, error: "Шаблон пуст" };
  await setSetting(key, value);
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Сбросить шаблон к стандартному (удалить переопределение). Возвращает сам
 * стандартный текст: редактор — контролируемый инпут со своим состоянием, и без
 * этого ему было нечем заменить содержимое (подставлял старый кастомный текст из
 * замыкания, а стандартный появлялся только после ремаунта страницы).
 */
export async function resetTemplate(
  key: "tpl_breakdown" | "tpl_storyboard" | "tpl_video" | "tpl_video_kling",
): Promise<string> {
  await requireAuth();
  const db = await getDb();
  await db.delete(settings).where(eq(settings.key, key));
  revalidatePath("/settings");
  return DEFAULT_SETTINGS[key];
}

export async function saveTechnique(input: {
  id?: string;
  title: string;
  category: string;
  prompt: string;
  negative: string;
  camera?: string;
  // lens/lighting редактор обязан присылать вместе с остальным: без них правка
  // карточки затирала оптику и свет в пустую строку (lens уходит в промпт шота)
  lens?: string;
  lighting?: string;
  tags?: string;
}): Promise<Result> {
  await requireAuth();
  if (!input.title.trim() || !input.prompt.trim()) {
    return { ok: false, error: "Название и промпт обязательны" };
  }
  await upsertTechniqueRow(input);
  revalidatePath("/knowledge");
  return { ok: true };
}

export async function deleteTechnique(id: string): Promise<void> {
  await requireAuth();
  await deleteTechniqueRow(id);
  revalidatePath("/knowledge");
}

/**
 * Вкл/выкл ВСЕЙ библиотеки приёмов. Выключенная библиотека остаётся на месте
 * (карточки, поиск, правка), но в модель не уходит совсем: ни индекса Enhance,
 * ни приёмов в промпте шота, ни пикера на карточке шота.
 */
export async function toggleTechniquesEnabled(enabled: boolean): Promise<void> {
  await requireAuth();
  await setSetting("techniques_enabled", enabled ? "1" : "0");
  revalidatePath("/knowledge");
  revalidatePath("/episodes", "layout"); // пикер приёмов на карточках шотов
}

/** «Удалить все» приёмы — библиотека остаётся пустой и не пересеивается вольтом. */
export async function deleteAllTechniques(): Promise<void> {
  await requireAuth();
  await deleteAllTechniqueRows();
  revalidatePath("/knowledge");
}

/** Язык интерфейса / тема — применяются через корневой layout. */
export async function saveUiPref(key: "ui_lang" | "ui_theme", value: string): Promise<void> {
  await requireAuth();
  await setSetting(key, value);
  revalidatePath("/", "layout");
}

/** Модель для простых запросов: правка групп, подбор приёмов, анализ референсов. */
export async function saveSimpleModel(value: string): Promise<void> {
  await requireAuth();
  await setSetting("llm_simple_model", value);
  revalidatePath("/settings");
}

// ---------- Higgsfield MCP (видео на кредитах подписки) ----------

export async function hfMcpDisconnect(): Promise<void> {
  await requireAuth();
  const { disconnect } = await import("@/lib/higgsfieldMcp");
  await disconnect();
  revalidatePath("/settings");
}

/** Список инструментов MCP — проверка подключения и discovery моделей. */
export async function hfMcpListTools(): Promise<
  { ok: true; tools: Array<{ name: string; description: string }> } | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const { listMcpTools } = await import("@/lib/higgsfieldMcp");
    const tools = await listMcpTools();
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

// ---------- Kling MCP (видео на платных кредитах подписки Kling) ----------

export async function klingMcpDisconnect(): Promise<void> {
  await requireAuth();
  const { disconnect } = await import("@/lib/klingMcp");
  await disconnect();
  revalidatePath("/settings");
}

/**
 * who_am_i — проверка подключения и discovery: возвращает личность,
 * доступные модели и спецификации параметров каждого инструмента.
 */
export async function klingWhoAmI(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const { isConnected, callKlingTool } = await import("@/lib/klingMcp");
    if (!(await isConnected())) return { ok: false, error: "not_connected" };
    const res = await callKlingTool("who_am_i", {}, { retry: true });
    const text = res.text || JSON.stringify(res.structured ?? {});
    return { ok: true, text: text.slice(0, 8000) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Баланс кредитов подписки Kling (query_membership_and_credits). */
export async function klingBalance(): Promise<
  { ok: true; credits: number | null; plan: string } | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const { isConnected, callKlingTool } = await import("@/lib/klingMcp");
    if (!(await isConnected())) return { ok: false, error: "not_connected" };
    const res = await callKlingTool("query_membership_and_credits", {}, { retry: true });
    const parsed = (res.structured ??
      JSON.parse(res.text || "{}")) as {
      availableRemainCredits?: number;
      membershipTypeDescription?: string;
      membershipType?: string;
    };
    return {
      ok: true,
      credits: parsed.availableRemainCredits ?? null,
      plan: parsed.membershipTypeDescription ?? parsed.membershipType ?? "",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Текущий баланс кредитов подписки Higgsfield (MCP balance). */
export async function hfBalance(): Promise<
  { ok: true; credits: number | null; plan: string; usd: number | null } | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const { isConnected, callMcpTool } = await import("@/lib/higgsfieldMcp");
    if (!(await isConnected())) return { ok: false, error: "not_connected" };
    const res = await callMcpTool("balance", {}, { retry: true });
    const credits = Number(res.text.match(/Credits:\s*([\d.]+)/i)?.[1] ?? "");
    const plan = res.text.match(/Plan:\s*(\w+)/i)?.[1] ?? "";
    const { creditsToUsd } = await import("@/lib/pricing");
    return {
      ok: true,
      credits: Number.isFinite(credits) ? credits : null,
      plan,
      usd: Number.isFinite(credits) ? creditsToUsd(credits) : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}
