"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { clearModelLog } from "@/lib/modelLog";

/** Кнопка «Очистить» на вкладке Console — стирает журнал обращений к моделям. */
export async function clearConsoleLog(): Promise<void> {
  await requireAuth();
  await clearModelLog();
  revalidatePath("/console");
}
