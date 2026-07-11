"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, settings } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { upsertTechniqueRow, deleteTechniqueRow } from "@/lib/director";

type Result = { ok: true } | { ok: false; error: string };

/** Сохранить шаблон промпта (tpl_storyboard | tpl_video). */
export async function saveTemplate(
  key: "tpl_storyboard" | "tpl_video",
  value: string,
): Promise<Result> {
  await requireAuth();
  if (!value.trim()) return { ok: false, error: "Шаблон пуст" };
  await setSetting(key, value);
  revalidatePath("/settings");
  return { ok: true };
}

/** Сбросить шаблон к стандартному (удалить переопределение). */
export async function resetTemplate(key: "tpl_storyboard" | "tpl_video"): Promise<void> {
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
