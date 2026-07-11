"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, settings } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { upsertTechniqueRow, deleteTechniqueRow, deleteAllTechniqueRows } from "@/lib/director";

type Result = { ok: true } | { ok: false; error: string };

/** Сохранить шаблон промпта (tpl_breakdown | tpl_storyboard | tpl_video). */
export async function saveTemplate(
  key: "tpl_breakdown" | "tpl_storyboard" | "tpl_video",
  value: string,
): Promise<Result> {
  await requireAuth();
  if (!value.trim()) return { ok: false, error: "Шаблон пуст" };
  await setSetting(key, value);
  revalidatePath("/settings");
  return { ok: true };
}

/** Сбросить шаблон к стандартному (удалить переопределение). */
export async function resetTemplate(
  key: "tpl_breakdown" | "tpl_storyboard" | "tpl_video",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.delete(settings).where(eq(settings.key, key));
  revalidatePath("/settings");
}

export async function saveTechnique(input: {
  id?: string;
  title: string;
  category: string;
  prompt: string;
  negative: string;
  camera?: string;
  tags?: string;
}): Promise<Result> {
  await requireAuth();
  if (!input.title.trim() || !input.prompt.trim()) {
    return { ok: false, error: "Название и промпт обязательны" };
  }
  await upsertTechniqueRow(input);
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteTechnique(id: string): Promise<void> {
  await requireAuth();
  await deleteTechniqueRow(id);
  revalidatePath("/settings");
}

/** «Удалить все» приёмы — библиотека остаётся пустой и не пересеивается вольтом. */
export async function deleteAllTechniques(): Promise<void> {
  await requireAuth();
  await deleteAllTechniqueRows();
  revalidatePath("/settings");
}

/** Язык интерфейса / тема — применяются через корневой layout. */
export async function saveUiPref(key: "ui_lang" | "ui_theme", value: string): Promise<void> {
  await requireAuth();
  await setSetting(key, value);
  revalidatePath("/", "layout");
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
