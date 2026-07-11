"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, generations, prompts, references, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  effectiveQuality,
  estimateJobCredits,
  getCatalog,
  pollActiveGenerations,
  recalcShotStatus,
  refreshCatalog,
  submitJobs,
  submitReferenceJob,
  type SubmitInput,
} from "@/lib/generation";
import { getProvider } from "@/lib/providers";
import { imageModelMeta } from "@/lib/imageModels";

/** Стоимость картинки: $ для Google, кредиты для Higgsfield. */
function imageCost(modelId: string, resolution: string): { usd: number | null; credits: number | null } {
  const meta = imageModelMeta(modelId);
  const value = meta?.cost[resolution] ?? Object.values(meta?.cost ?? {})[0] ?? 0;
  return meta?.unit === "usd" ? { usd: value, credits: null } : { usd: null, credits: value };
}

/** Модель картинок по умолчанию — первая доступная в каталоге (Pro при Google). */
async function defaultImageModel(preferred?: string): Promise<string> {
  const catalog = await getCatalog("image");
  if (preferred && catalog.some((m) => m.id === preferred)) return preferred;
  const nano = catalog.find((m) => m.id.includes("nano_banana")) ?? catalog[0];
  return nano?.id ?? "nano_banana_pro";
}

type Result<T = undefined> =
  | { ok: true; data?: T; needsConfirm?: false }
  | { ok: false; error: string }
  | { ok: false; needsConfirm: true; estimate: number; limit: number };

/** Суммарная оценка по формуле spec §3.1 (сервер — источник истины). */
async function estimateTotal(input: SubmitInput): Promise<number> {
  const catalog = await getCatalog("video");
  return input.modelIds.reduce((sum, id) => {
    const m = catalog.find((c) => c.id === id);
    const q = effectiveQuality(id, input.quality, m?.qualities ?? []);
    return sum + (estimateJobCredits(m?.credits ?? null, input.durationSec, q) ?? 0);
  }, 0);
}

/** U3/A-B: запуск задач по чекбоксам моделей; предохранитель по кредитам (M4). */
export async function startGeneration(
  input: SubmitInput & { confirmed?: boolean },
): Promise<Result> {
  await requireAuth();
  try {
    if (!input.modelIds.length) return { ok: false, error: "Выберите хотя бы одну модель" };
    const estimate = await estimateTotal(input);
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

/** Nano Banana: новый референс серии (spec §3.2). */
export async function startNanoBanana(input: {
  episodeId: string;
  prompt: string;
  aspectRatio: string;
  resolution: "1k" | "2k" | "4k";
  model?: string;
}): Promise<Result> {
  await requireAuth();
  try {
    if (!input.prompt.trim()) return { ok: false, error: "Опишите изображение" };
    const modelId = await defaultImageModel(input.model);
    const { usd, credits } = imageCost(modelId, input.resolution);
    await submitReferenceJob({
      episodeId: input.episodeId,
      model: modelId,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      sourceTag: "nano-banana",
      credits,
      usd,
    });
    revalidatePath(`/episodes/${input.episodeId}/refs`);
    revalidatePath("/queue");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/** Upscale ×2 (spec §2.6) — Nano Banana, 4 кр; результат — новый референс. */
export async function upscaleReference(refId: string): Promise<Result> {
  await requireAuth();
  try {
    const db = await getDb();
    const [ref] = await db.select().from(references).where(eq(references.id, refId));
    if (!ref?.episodeId) return { ok: false, error: "Референс не найден" };
    const modelId = await defaultImageModel();
    const { usd, credits } = imageCost(modelId, "4k");
    await submitReferenceJob({
      episodeId: ref.episodeId,
      model: modelId,
      prompt:
        "Upscale this exact image 2x. Preserve composition, subjects, lighting and color grading precisely. Enhance fine detail and sharpness only.",
      aspectRatio: aspectOf(ref.width, ref.height),
      resolution: "4k",
      sourceRefIds: [refId],
      sourceTag: "upscale",
      credits,
      usd,
    });
    revalidatePath(`/episodes/${ref.episodeId}/refs`);
    revalidatePath("/queue");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/** Правка референса (spec §2.6): произвольный промпт + доп. референсы; исходник не трогается. */
export async function editReference(input: {
  refId: string;
  prompt: string;
  extraRefIds: string[];
}): Promise<Result> {
  await requireAuth();
  try {
    const db = await getDb();
    const [ref] = await db.select().from(references).where(eq(references.id, input.refId));
    if (!ref?.episodeId) return { ok: false, error: "Референс не найден" };
    if (!input.prompt.trim()) return { ok: false, error: "Опишите правку" };
    const modelId = await defaultImageModel();
    const { usd, credits } = imageCost(modelId, "2k");
    await submitReferenceJob({
      episodeId: ref.episodeId,
      model: modelId,
      prompt: input.prompt,
      aspectRatio: aspectOf(ref.width, ref.height),
      resolution: "2k",
      sourceRefIds: [input.refId, ...input.extraRefIds],
      sourceTag: "edit",
      credits,
      usd,
    });
    revalidatePath(`/episodes/${ref.episodeId}/refs`);
    revalidatePath("/queue");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

function aspectOf(width: number | null, height: number | null): string {
  if (!width || !height) return "16:9";
  const ratio = width / height;
  const known: Array<[string, number]> = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["21:9", 21 / 9],
  ];
  known.sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio));
  return known[0][0];
}

/** Поллинг статусов: дергается клиентом, пока есть активные задачи. */
export async function pollNow(): Promise<{ active: number; updated: number }> {
  await requireAuth();
  const res = await pollActiveGenerations();
  if (res.updated > 0) revalidatePath("/queue");
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
    .set({ status: "failed", error: "Отменено пользователем · кредиты не списаны" })
    .where(eq(generations.id, generationId));
  // отмена последней активной задачи откатывает статус шота назад (spec §1)
  if (gen.shotId) {
    await recalcShotStatus(gen.shotId);
    const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${gen.shotId}`);
  }
  revalidatePath("/queue");
}

/** Повторить неудавшуюся задачу тем же промптом и моделью. */
export async function retryGeneration(generationId: string): Promise<Result> {
  await requireAuth();
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!gen) return { ok: false, error: "Задача не найдена" };
  if (!gen.shotId) return { ok: false, error: "Повтор доступен только для видео-задач" };
  const [prompt] = gen.promptId
    ? await db.select().from(prompts).where(eq(prompts.id, gen.promptId))
    : [];
  if (!prompt) return { ok: false, error: "У задачи нет промпта — соберите его заново" };
  const params = JSON.parse(gen.paramsJson || "{}") as {
    aspect_ratio?: string;
    duration?: number;
    quality?: string;
    start_frame_ref?: string | null;
  };
  return startGeneration({
    shotId: gen.shotId,
    promptId: prompt.id,
    modelIds: [gen.model],
    durationSec: params.duration ?? 15,
    aspectRatio: params.aspect_ratio ?? "16:9",
    quality: params.quality ?? "720p",
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
