"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, generations, prompts, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  getCatalog,
  pollActiveGenerations,
  refreshCatalog,
  submitJobs,
  type SubmitInput,
} from "@/lib/generation";
import { getProvider } from "@/lib/providers";

type Result<T = undefined> =
  | { ok: true; data?: T; needsConfirm?: false }
  | { ok: false; error: string }
  | { ok: false; needsConfirm: true; estimate: number; limit: number };

/** U3/A-B: запуск задач по чекбоксам моделей; предохранитель по кредитам (M4). */
export async function startGeneration(
  input: SubmitInput & { confirmed?: boolean },
): Promise<Result> {
  await requireAuth();
  try {
    if (!input.modelIds.length) return { ok: false, error: "Выберите хотя бы одну модель" };
    const catalog = await getCatalog();
    const estimate = input.modelIds.reduce((sum, id) => {
      const m = catalog.find((c) => c.id === id);
      return sum + (m?.credits ?? 0);
    }, 0);
    const limit = Number(await getSetting("credit_confirm_limit")) || 0;
    if (!input.confirmed && limit > 0 && estimate > limit) {
      return { ok: false, needsConfirm: true, estimate, limit };
    }
    await submitJobs(input);
    const [shot] = await (await getDb()).select().from(shots).where(eq(shots.id, input.shotId));
    if (shot) {
      revalidatePath(`/episodes/${shot.episodeId}/shots/${input.shotId}`);
      revalidatePath("/queue");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/** Поллинг статусов: дергается клиентом, пока есть активные задачи. */
export async function pollNow(): Promise<{ active: number; updated: number }> {
  await requireAuth();
  const res = await pollActiveGenerations();
  if (res.updated > 0) {
    revalidatePath("/queue");
  }
  return res;
}

export async function cancelGeneration(generationId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!gen || (gen.status !== "queued" && gen.status !== "running")) return;
  const provider = getProvider();
  if (provider.cancel && gen.providerJobId && gen.provider === provider.name) {
    const bundle = JSON.parse(gen.paramsJson || "{}") as { _urls?: { cancelUrl?: string } };
    await provider
      .cancel({ jobId: gen.providerJobId, cancelUrl: bundle._urls?.cancelUrl })
      .catch(() => {});
  }
  await db
    .update(generations)
    .set({ status: "failed", error: "Отменено пользователем" })
    .where(eq(generations.id, generationId));
  const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
  if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${gen.shotId}`);
  revalidatePath("/queue");
}

/** Повторить неудавшуюся задачу тем же промптом и моделью. */
export async function retryGeneration(generationId: string): Promise<Result> {
  await requireAuth();
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!gen) return { ok: false, error: "Задача не найдена" };
  const [prompt] = gen.promptId
    ? await db.select().from(prompts).where(eq(prompts.id, gen.promptId))
    : [];
  if (!prompt) return { ok: false, error: "У задачи нет промпта — соберите его заново" };
  const params = JSON.parse(gen.paramsJson || "{}") as {
    aspect_ratio?: string;
    duration?: number;
    start_frame_ref?: string | null;
  };
  return startGeneration({
    shotId: gen.shotId,
    promptId: prompt.id,
    modelIds: [gen.model],
    durationSec: params.duration ?? 15,
    aspectRatio: params.aspect_ratio ?? "16:9",
    startFrameRefId: params.start_frame_ref ?? undefined,
    confirmed: true,
  });
}

export async function refreshModelCatalog(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  try {
    const res = await refreshCatalog();
    revalidatePath("/costs");
    return { ok: true, message: `Каталог обновлён: ${res.count} моделей (источник: ${res.source})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Не удалось обновить каталог" };
  }
}
