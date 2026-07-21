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
  preflightJobCost,
  recalcShotStatus,
  refreshCatalog,
  submitJobs,
  submitReferenceJob,
  type ReferenceJobInput,
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
): Promise<Result<{ queued: number }>> {
  await requireAuth();
  try {
    if (!input.modelIds.length) return { ok: false, error: "Выберите хотя бы одну модель" };
    // MCP-only для Higgsfield: молчаливый переход на Cloud API (это ДРУГОЙ платный
    // кошелёк) запрещён. Если связь с Higgsfield MCP разорвана — задачу НЕ ставим и
    // сообщаем прямо, чтобы пользователь переподключил MCP, а не платил из Cloud.
    // Kling-модели идут через свой MCP (provider=kling-mcp) — их не блокируем.
    const catalog = await getCatalog("video");
    const usesHiggsfield = input.modelIds.some(
      (id) => (catalog.find((m) => m.id === id)?.provider ?? "") !== "kling-mcp",
    );
    if (usesHiggsfield) {
      const { isConnected } = await import("@/lib/higgsfieldMcp");
      if (!(await isConnected())) {
        return {
          ok: false,
          error:
            "Нет связи с Higgsfield (MCP). Подключите его в «Настройки → Higgsfield» и повторите — генерация не запущена.",
        };
      }
    }
    const estimate = await estimateTotal(input);
    const limit = Number(await getSetting("credit_confirm_limit")) || 0;
    if (!input.confirmed && limit > 0 && estimate > limit) {
      return { ok: false, needsConfirm: true, estimate, limit };
    }
    // Быстрая постановка: submitJobs мгновенно создаёт карточки задач ("queued") и
    // уносит отправку провайдеру в фон — экран не висит. Статус меняется в карточках.
    const { queued } = await submitJobs(input);
    const [shot] = await (await getDb()).select().from(shots).where(eq(shots.id, input.shotId));
    if (shot) {
      revalidatePath(`/episodes/${shot.episodeId}/shots/${input.shotId}`);
      revalidatePath("/queue");
    }
    return { ok: true, data: { queued } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/**
 * Правка готового видео-дубля: исходник уходит видео-референсом в Seedance
 * (Higgsfield MCP) + инструкция, что изменить; результат — новый дубль
 * того же шота. Быстрая постановка как в startGeneration: queued-строка
 * мгновенно, сеть в фоне. Стоимость уточняется бесплатным get_cost там же.
 */
export async function startVideoEdit(input: {
  generationId: string;
  instruction: string;
  /** фрагмент таймлайна «от/до» в секундах; обе границы пусты = весь ролик */
  fromSec?: number | null;
  toSec?: number | null;
}): Promise<Result> {
  await requireAuth();
  try {
    const instruction = input.instruction.trim();
    if (!instruction) return { ok: false, error: "Опишите, что изменить в видео" };
    const fromSec = typeof input.fromSec === "number" && input.fromSec >= 0 ? input.fromSec : null;
    const toSec = typeof input.toSec === "number" && input.toSec > 0 ? input.toSec : null;
    if (fromSec != null && toSec != null && toSec <= fromSec) {
      return { ok: false, error: "Фрагмент пуст: конец должен быть позже начала" };
    }
    // правка идёт только через Higgsfield MCP — без связи задачу не ставим
    const { isConnected } = await import("@/lib/higgsfieldMcp");
    if (!(await isConnected())) {
      return {
        ok: false,
        error:
          "Нет связи с Higgsfield (MCP). Подключите его в «Настройки → Higgsfield» и повторите — правка не запущена.",
      };
    }
    const { submitVideoEditJob } = await import("@/lib/videoEdit");
    await submitVideoEditJob({ sourceGenerationId: input.generationId, instruction, fromSec, toSec });
    const db = await getDb();
    const [src] = await db.select().from(generations).where(eq(generations.id, input.generationId));
    if (src?.shotId) {
      revalidatePath(`/episodes/${src.episodeId}/shots/${src.shotId}`);
      revalidatePath("/queue");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить правку" };
  }
}

/**
 * Файл дубля для скачивания: весь ролик или диапазон «от/до», в оригинальном
 * качестве или 720p-апскейлом. Готовится ffmpeg-ом на сервере при первом
 * запросе, дальше отдаётся кеш (results/{shotId}/{genId}.<вариант>.mp4).
 * Возвращает URL готового файла — клиент запускает скачивание сам.
 */
export async function prepareVideoDownload(input: {
  generationId: string;
  quality: "480p" | "720p"; // 480p = оригинальное качество без перекодирования
  fromSec?: number | null;
  toSec?: number | null;
}): Promise<Result<{ url: string }>> {
  await requireAuth();
  try {
    const db = await getDb();
    const [gen] = await db.select().from(generations).where(eq(generations.id, input.generationId));
    if (!gen || gen.kind !== "video" || !gen.resultStoragePath) {
      return { ok: false, error: "Видео не найдено" };
    }
    const fromSec = typeof input.fromSec === "number" && input.fromSec >= 0 ? input.fromSec : null;
    const toSec = typeof input.toSec === "number" && input.toSec > 0 ? input.toSec : null;
    if (fromSec != null && toSec != null && toSec <= fromSec) {
      return { ok: false, error: "Фрагмент пуст: конец должен быть позже начала" };
    }
    const { ensure720pFile, ensureClipFile } = await import("@/lib/videoEdit");
    let key = gen.resultStoragePath;
    if (fromSec != null || toSec != null) {
      key = await ensureClipFile(key, fromSec ?? 0, toSec, input.quality === "720p");
    } else if (input.quality === "720p") {
      key = await ensure720pFile(key);
    }
    const { getFileUrl } = await import("@/lib/storage");
    return { ok: true, data: { url: await getFileUrl(key) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось подготовить файл" };
  }
}

/**
 * Точная стоимость по каждой модели ДО запуска (Higgsfield get_cost — задача
 * не создаётся, кредиты не списываются). exact=false — сетевой фолбэк-формула.
 */
export async function preflightVideoCredits(input: {
  modelIds: string[];
  durationSec: number;
  aspectRatio: string;
  quality: string;
}): Promise<Array<{ id: string; credits: number | null; exact: boolean }>> {
  await requireAuth();
  const catalog = await getCatalog("video");
  return Promise.all(
    input.modelIds.map(async (id) => {
      const m = catalog.find((c) => c.id === id);
      const quality = effectiveQuality(id, input.quality, m?.qualities ?? []);
      const exact = await preflightJobCost(id, input.durationSec, input.aspectRatio, quality);
      if (exact != null) return { id, credits: exact, exact: true };
      return {
        id,
        credits: estimateJobCredits(m?.credits ?? null, input.durationSec, quality),
        exact: false,
      };
    }),
  );
}

/**
 * «Проверить сейчас»: живой опрос статуса одной задачи по требованию —
 * возвращает подтверждённый статус или текст ошибки связи (не молчит).
 */
export async function probeGeneration(generationId: string): Promise<{
  status: string;
  error: string | null;
  pollError: string | null;
}> {
  await requireAuth();
  await pollActiveGenerations([generationId]);
  const db = await getDb();
  const [gen] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!gen) return { status: "unknown", error: "Задача не найдена", pollError: null };
  const bundle = JSON.parse(gen.paramsJson || "{}") as { _poll?: { error?: string } };
  if (gen.shotId) {
    const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${gen.shotId}`);
  }
  revalidatePath("/queue");
  return { status: gen.status, error: gen.error ?? null, pollError: bundle._poll?.error ?? null };
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

/**
 * Раскадровочные метки исходника → в задачу правки/апскейла. Без них результат
 * становился обычным референсом: поправленный ЛИСТ пропадал со вкладки
 * «Раскадровка» и его нельзя было разрезать, а апскейл КАДРА терял свою группу и
 * уезжал в общую кучу референсов — цепочка «лист → кадр → шот» рвалась ровно там,
 * где пользователь пытался улучшить результат.
 */
function storyboardMeta(
  ref: typeof references.$inferSelect,
  suffix: string,
): Pick<
  ReferenceJobInput,
  "sbGrid" | "sbShotId" | "sbParentId" | "sbPanel" | "sbPanels" | "refSource" | "caption"
> {
  const isSheet = ref.grid === 4 || ref.grid === 9;
  if (!isSheet && ref.source !== "storyboard-frame") return {};
  let sbPanels: string[] = [];
  try {
    const parsed = JSON.parse(ref.sbPanels || "[]");
    if (Array.isArray(parsed)) sbPanels = parsed as string[];
  } catch {}
  return {
    sbGrid: ref.grid,
    sbShotId: ref.sbShotId,
    sbParentId: ref.parentId,
    sbPanel: ref.sbPanel,
    sbPanels,
    refSource: ref.source,
    caption: `${ref.caption || ref.token || "раскадровка"} · ${suffix}`,
  };
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
      ...storyboardMeta(ref, "⤢ 2×"),
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
      ...storyboardMeta(ref, "правка"),
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
  const remoteCancel = Boolean(provider.cancel) && gen.provider === provider.name;
  if (provider.cancel && gen.providerJobId && gen.provider === provider.name) {
    const bundle = JSON.parse(gen.paramsJson || "{}") as { _urls?: { cancelUrl?: string } };
    await provider
      .cancel({ jobId: gen.providerJobId, cancelUrl: bundle._urls?.cancelUrl })
      .catch(() => {});
  }
  await db
    .update(generations)
    .set({
      status: "failed",
      // честно: MCP не умеет отменять — принятая задача у Higgsfield может
      // доработать и списать кредиты, мы лишь перестаём её отслеживать
      error: remoteCancel
        ? "Отменено пользователем · кредиты не списаны"
        : "Отменено пользователем · принятая задача у провайдера могла продолжиться",
    })
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
export async function retryGeneration(
  generationId: string,
): Promise<Result<{ queued: number }>> {
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
    bitrate_mode?: "high" | "standard";
  };
  return startGeneration({
    shotId: gen.shotId,
    promptId: prompt.id,
    modelIds: [gen.model],
    durationSec: params.duration ?? 15,
    aspectRatio: params.aspect_ratio ?? "9:16",
    quality: params.quality ?? "720p",
    startFrameRefId: params.start_frame_ref ?? undefined,
    bitrate: params.bitrate_mode,
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
