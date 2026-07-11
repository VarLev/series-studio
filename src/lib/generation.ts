/**
 * Ядро центра генерации (M4): каталог, постановка видео-задач и задач-референсов,
 * поллинг статусов, приземление результатов (M5). Используется server actions,
 * cron-роутом и вебхуком.
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
  getDb,
  generations,
  prompts,
  references,
  shots,
  videoModels,
} from "@/lib/db";
import {
  getImageProvider,
  googleImageConfigured,
  pickVideoProvider,
} from "@/lib/providers";
import { CATALOG_SEED } from "@/lib/providers/higgsfield";
import { readMockImage, readMockSample } from "@/lib/providers/mock";
import { getFileUrl, putFile, readFile, saveFromUrl } from "@/lib/storage";
import { imageModelMeta, type ImageModelMeta } from "@/lib/imageModels";

// ---------- Каталог моделей (TZ §0.2) ----------

/**
 * Виртуальные модели: в каталоге и UI — отдельная строка, провайдеру уходит
 * базовый id с фиксированными параметрами (Seedance Fast = seedance_2_0 mode=fast).
 */
const VIRTUAL_MODELS: Record<string, { base: string; params: Record<string, string | number> }> = {
  seedance_2_0_fast: { base: "seedance_2_0", params: { mode: "fast" } },
};

export async function refreshCatalog(): Promise<{ count: number; source: string }> {
  const provider = await pickVideoProvider();
  const imageProvider = getImageProvider();
  const videoModelsList = (await provider.listModels()).filter((m) => m.kind === "video");
  // виртуальные видео-строки (Seedance Fast) — из сида, если провайдер их не отдал
  for (const seed of CATALOG_SEED) {
    if (VIRTUAL_MODELS[seed.id] && !videoModelsList.some((m) => m.id === seed.id)) {
      videoModelsList.push({ ...seed });
    }
  }
  // image-модели берём у image-провайдера (Google при наличии ключа, иначе Higgsfield/мок)
  const imageModelsList =
    imageProvider.name === provider.name
      ? (await provider.listModels()).filter((m) => m.kind === "image")
      : (await imageProvider.listModels()).filter((m) => m.kind === "image");
  const models = [...videoModelsList, ...imageModelsList];
  const providerByKind = (kind: string) => (kind === "image" ? imageProvider.name : provider.name);

  const db = await getDb();
  // полная пересборка: при смене провайдера (mock → MCP) старые строки каталога
  // (лишние Kling, чужие image-модели) не должны оставаться в выборе
  await db.delete(videoModels);
  let sort = 0;
  for (const m of models) {
    await db
      .insert(videoModels)
      .values({
        id: m.id,
        name: m.name,
        kind: m.kind,
        provider: providerByKind(m.kind),
        paramsJson: JSON.stringify(m.params ?? {}),
        credits: m.credits ?? null,
        sortIndex: sort++,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: videoModels.id,
        set: {
          name: m.name,
          kind: m.kind,
          provider: providerByKind(m.kind),
          paramsJson: JSON.stringify(m.params ?? {}),
          credits: m.credits ?? null,
          fetchedAt: new Date(),
        },
      });
  }
  return { count: models.length, source: `${provider.name}+${imageProvider.name}` };
}

export interface CatalogModel {
  id: string;
  name: string;
  kind: string;
  credits: number | null;
  qualities: string[];
}

/** Какие качества поддерживает модель (spec §3.1: 480p только Seedance). */
function qualitiesFor(id: string, paramsJson: string): string[] {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>;
    const res = params.resolution;
    if (Array.isArray(res)) {
      return res.filter((r): r is string => typeof r === "string" && /^\d+p$/.test(r));
    }
  } catch {}
  if (id.startsWith("kling")) return ["720p", "1080p"];
  return ["480p", "720p", "1080p"];
}

export async function getCatalog(kind?: "video" | "image"): Promise<CatalogModel[]> {
  const db = await getDb();
  let rows = await db
    .select()
    .from(videoModels)
    .where(eq(videoModels.active, true))
    .orderBy(asc(videoModels.sortIndex));
  // пустой каталог или каталог, засеянный до появления виртуальных моделей → пересеять
  const missingVirtual = Object.keys(VIRTUAL_MODELS).some((id) => !rows.some((r) => r.id === id));
  // image-провайдер сменился (появился/убрали GEMINI_API_KEY) → пересеять image-строки
  const google = googleImageConfigured();
  const hasGoogleRows = rows.some((r) => r.id === "nano_banana_pro");
  const imageProviderChanged = google !== hasGoogleRows;
  if (!rows.length || missingVirtual || imageProviderChanged) {
    await refreshCatalog();
    rows = await db
      .select()
      .from(videoModels)
      .where(eq(videoModels.active, true))
      .orderBy(asc(videoModels.sortIndex));
  }
  return rows
    .filter((r) => !kind || r.kind === kind)
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      credits: r.credits,
      qualities: r.kind === "video" ? qualitiesFor(r.id, r.paramsJson) : [],
    }));
}

/** Доступные image-модели для пикеров (клиент-безопасные метаданные). */
export async function availableImageModels(): Promise<ImageModelMeta[]> {
  const catalog = await getCatalog("image");
  return catalog
    .map((c) => imageModelMeta(c.id))
    .filter((m): m is ImageModelMeta => Boolean(m));
}

// ---------- Оценка кредитов (spec §3.1) ----------

const QUALITY_COEF: Record<string, number> = { "480p": 0.6, "720p": 1, "1080p": 1.6 };

/** оценка = база × (сек/5) × коэф. качества */
export function estimateJobCredits(
  base: number | null,
  durationSec: number,
  quality: string,
): number | null {
  if (base == null) return null;
  return Math.round(base * (durationSec / 5) * (QUALITY_COEF[quality] ?? 1));
}

/** Kling не поддерживает 480p — уходит в 720p (spec §3.1). */
export function effectiveQuality(modelId: string, quality: string, qualities: string[]): string {
  if (qualities.includes(quality)) return quality;
  return qualities.includes("720p") ? "720p" : (qualities[0] ?? quality);
}

// ---------- Постановка задач ----------

interface UrlBundle {
  _urls?: { statusUrl?: string; cancelUrl?: string };
  [key: string]: unknown;
}

async function publicUrlForReference(refId: string): Promise<string | null> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return null;
  const provider = await pickVideoProvider();
  // Локальный диск недоступен провайдеру извне — передаём байты через его upload API
  // (Cloud API → files/generate-upload-url; MCP → media_upload+confirm → media_id).
  if (!process.env.SUPABASE_URL && provider.uploadFile) {
    const data = await readFile(ref.storagePath);
    const contentType = ref.storagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    return provider.uploadFile(data, contentType);
  }
  return getFileUrl(ref.storagePath);
}

/** Байты референса inline (base64) — для Google Gemini (inline_data). */
async function referenceImageBytes(refId: string): Promise<{ data: string; mimeType: string } | null> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return null;
  const data = await readFile(ref.storagePath);
  const mimeType = ref.storagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return { data: data.toString("base64"), mimeType };
}

/** Провайдер-специфичная форма параметров видео-задачи. */
function shapeVideoParams(
  modelId: string,
  durationSec: number,
  aspectRatio: string,
  quality: string,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    aspect_ratio: aspectRatio,
    duration: durationSec,
  };
  if (modelId.startsWith("kling")) {
    params.mode = quality === "1080p" ? "pro" : "std";
  } else {
    params.resolution = quality;
  }
  return params;
}

export interface SubmitInput {
  shotId: string;
  promptId: string;
  modelIds: string[];
  startFrameRefId?: string;
  durationSec: number;
  aspectRatio: string;
  quality: string;
}

export async function submitJobs(input: SubmitInput): Promise<{ submitted: number }> {
  const db = await getDb();
  const provider = await pickVideoProvider();
  const [prompt] = await db.select().from(prompts).where(eq(prompts.id, input.promptId));
  if (!prompt) throw new Error("Промпт не найден");
  const [shot] = await db.select().from(shots).where(eq(shots.id, input.shotId));
  if (!shot) throw new Error("Шот не найден");
  const catalog = await getCatalog("video");

  const startImageUrl = input.startFrameRefId
    ? ((await publicUrlForReference(input.startFrameRefId)) ?? undefined)
    : undefined;

  let submitted = 0;
  for (const modelId of input.modelIds) {
    const model = catalog.find((m) => m.id === modelId);
    const quality = effectiveQuality(modelId, input.quality, model?.qualities ?? []);
    const virtual = VIRTUAL_MODELS[modelId];
    const params = {
      ...shapeVideoParams(modelId, input.durationSec, input.aspectRatio, quality),
      ...(virtual?.params ?? {}),
    };
    const sub = await provider.submit({
      model: virtual?.base ?? modelId,
      prompt: prompt.text,
      negativePrompt: prompt.negativePrompt ?? undefined,
      params,
      startImageUrl,
    });
    const paramsJson: UrlBundle = {
      ...params,
      quality,
      start_frame_ref: input.startFrameRefId ?? null,
      estimate: estimateJobCredits(model?.credits ?? null, input.durationSec, quality),
      _urls: { statusUrl: sub.statusUrl, cancelUrl: sub.cancelUrl },
    };
    await db.insert(generations).values({
      id: crypto.randomUUID(),
      shotId: input.shotId,
      episodeId: shot.episodeId,
      kind: "video",
      promptId: input.promptId,
      provider: provider.name,
      model: modelId,
      paramsJson: JSON.stringify(paramsJson),
      status: "queued",
      providerJobId: sub.jobId,
      source: "api",
    });
    submitted++;
  }
  await db.update(shots).set({ status: "generating" }).where(eq(shots.id, input.shotId));
  return { submitted };
}

// ---------- Задачи-референсы (Nano Banana / Upscale / Правка, spec §2.6/§3.2) ----------

export interface ReferenceJobInput {
  episodeId: string;
  model: string; // image-модель из каталога
  prompt: string;
  aspectRatio: string;
  resolution: string; // 1k | 2k | 4k
  sourceRefIds?: string[]; // референсы-входы (правка / upscale)
  sourceTag: "nano-banana" | "upscale" | "edit" | "storyboard";
  credits?: number | null;
  /** цена в $ для Google-провайдера (Higgsfield считает в кредитах). */
  usd?: number | null;
  /** Лист раскадровки: сколько кадров в сетке (4 | 9) и к какому шоту относится. */
  sbGrid?: number;
  sbShotId?: string | null;
  caption?: string;
}

export async function submitReferenceJob(input: ReferenceJobInput): Promise<void> {
  const db = await getDb();
  const provider = getImageProvider();
  const google = provider.name === "google";
  const params: Record<string, string | number> = {
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
  };

  // референсы: Google получает байты inline, Higgsfield — публичные URL/upload
  const referenceUrls: string[] = [];
  const referenceImages: Array<{ data: string; mimeType: string }> = [];
  for (const refId of input.sourceRefIds ?? []) {
    if (google) {
      const bytes = await referenceImageBytes(refId);
      if (bytes) referenceImages.push(bytes);
    } else {
      const url = await publicUrlForReference(refId);
      if (url) referenceUrls.push(url);
    }
  }

  const sub = await provider.submit({
    model: input.model,
    prompt: input.prompt,
    params,
    referenceUrls: referenceUrls.length ? referenceUrls : undefined,
    referenceImages: referenceImages.length ? referenceImages : undefined,
  });
  const paramsJson: UrlBundle = {
    ...params,
    source_tag: input.sourceTag,
    source_refs: input.sourceRefIds ?? [],
    estimate: input.credits ?? null,
    usd: google ? input.usd ?? null : null,
    sb_grid: input.sbGrid ?? null,
    sb_shot_id: input.sbShotId ?? null,
    caption: input.caption ?? null,
    _urls: { statusUrl: sub.statusUrl, cancelUrl: sub.cancelUrl },
  };
  const genId = crypto.randomUUID();
  await db.insert(generations).values({
    id: genId,
    shotId: null,
    episodeId: input.episodeId,
    kind: "reference",
    promptId: null,
    provider: provider.name,
    model: input.model,
    paramsJson: JSON.stringify(paramsJson),
    status: "queued",
    providerJobId: sub.jobId,
    source: "api",
  });
  // Google синхронный — результат уже готов, приземляем в этом же запросе
  if (provider.synchronous) {
    await pollActiveGenerations([genId]);
  }
}

// ---------- Референсы серии: токены и размеры ----------

export async function nextRefToken(episodeId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(references).where(eq(references.episodeId, episodeId));
  const max = rows.reduce((acc, r) => {
    const n = r.token?.match(/^REF_(\d+)$/)?.[1];
    return n ? Math.max(acc, Number(n)) : acc;
  }, 0);
  return `REF_${String(max + 1).padStart(2, "0")}`;
}

export async function probeImageSize(
  data: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(data).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

// ---------- Статусная модель шота (spec §1) ----------

/** Пересчёт статуса шота от его генераций (отмена/отказ откатывают назад). */
export async function recalcShotStatus(shotId: string): Promise<void> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) return;
  const gens = await db.select().from(generations).where(eq(generations.shotId, shotId));
  const hasActive = gens.some((g) => g.status === "queued" || g.status === "running");
  const hasDone = gens.some((g) => g.status === "done");
  let next: string;
  if (shot.winnerGenerationId && hasDone) next = "approved";
  else if (hasActive) next = "generating";
  else if (hasDone) next = "review";
  else {
    const promptRows = await db.select().from(prompts).where(eq(prompts.shotId, shotId));
    next = promptRows.length ? "prompted" : "draft";
  }
  if (next !== shot.status) {
    await db.update(shots).set({ status: next }).where(eq(shots.id, shotId));
  }
}

// ---------- Поллинг и приземление результатов ----------

const ACTIVE = ["queued", "running"] as const;

async function landReferenceResult(
  gen: typeof generations.$inferSelect,
  resultUrl: string,
): Promise<void> {
  const db = await getDb();
  const params = JSON.parse(gen.paramsJson || "{}") as {
    source_tag?: string;
    aspect_ratio?: string;
    sb_grid?: number | null;
    sb_shot_id?: string | null;
    caption?: string | null;
  };
  let data: Buffer;
  let ext = ".jpg";
  if (resultUrl === "mock://sample-image") {
    data = await readMockImage();
  } else if (resultUrl.startsWith("google://")) {
    // синхронный результат Google — байты лежат у провайдера в памяти процесса
    const provider = getImageProvider();
    const taken = provider.takeResult?.(resultUrl.replace("google://", ""));
    if (!taken) throw new Error("Результат Google утерян (сервер перезапускался)");
    data = taken.data;
    ext = taken.mimeType.includes("png") ? ".png" : ".jpg";
  } else {
    const res = await fetch(resultUrl);
    if (!res.ok) throw new Error(`Не удалось скачать референс (${res.status})`);
    data = Buffer.from(await res.arrayBuffer());
    ext = resultUrl.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[0] ?? ".jpg";
  }
  const refId = crypto.randomUUID();
  const storagePath = await putFile(
    `refs/series/${gen.episodeId}/${refId}${ext}`,
    data,
    ext === ".png" ? "image/png" : "image/jpeg",
  );
  const { width, height } = await probeImageSize(data);
  await db.insert(references).values({
    id: refId,
    episodeId: gen.episodeId,
    storagePath,
    caption: params.caption ?? "",
    source: params.source_tag ?? "nano-banana",
    token: await nextRefToken(gen.episodeId!),
    width,
    height,
    grid: params.sb_grid ?? null,
    sbShotId: params.sb_shot_id ?? null,
  });
  await db
    .update(generations)
    .set({ status: "done", resultStoragePath: storagePath })
    .where(eq(generations.id, gen.id));
}

export async function pollActiveGenerations(onlyIds?: string[]): Promise<{
  active: number;
  updated: number;
}> {
  const db = await getDb();
  const videoProvider = await pickVideoProvider();
  const imageProvider = getImageProvider();
  let rows = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  if (onlyIds?.length) rows = rows.filter((r) => onlyIds.includes(r.id));

  let updated = 0;
  for (const gen of rows) {
    // image-задачи опрашивает image-провайдер (Google/Higgsfield), видео — видео-провайдер
    const provider = gen.kind === "reference" ? imageProvider : videoProvider;
    if (!gen.providerJobId || gen.provider !== provider.name) continue;
    const bundle = JSON.parse(gen.paramsJson || "{}") as UrlBundle;
    try {
      const status = await provider.getStatus({
        jobId: gen.providerJobId,
        statusUrl: bundle._urls?.statusUrl,
        cancelUrl: bundle._urls?.cancelUrl,
      });
      if (status.status === "queued" || status.status === "running") {
        if (status.status !== gen.status) {
          await db.update(generations).set({ status: status.status }).where(eq(generations.id, gen.id));
          updated++;
        }
        continue;
      }
      // терминальные статусы
      if (status.status === "done") {
        const url = status.resultUrls[0];
        if (gen.kind === "reference") {
          if (!url) throw new Error("Провайдер завершил задачу без URL результата");
          await landReferenceResult(gen, url);
          if (status.credits != null) {
            await db
              .update(generations)
              .set({ creditsSpent: status.credits })
              .where(eq(generations.id, gen.id));
          }
          updated++;
          continue;
        }
        let storagePath: string;
        if (url === "mock://sample") {
          storagePath = await putFile(
            `results/${gen.shotId}/${gen.id}.mp4`,
            await readMockSample(),
            "video/mp4",
          );
        } else if (url) {
          const ext = url.split("?")[0].match(/\.(mp4|webm|mov|png|jpe?g|webp)$/i)?.[0] ?? ".mp4";
          storagePath = await saveFromUrl(url, `results/${gen.shotId}/${gen.id}${ext}`);
        } else {
          throw new Error("Провайдер завершил задачу без URL результата");
        }
        await db
          .update(generations)
          .set({
            status: "done",
            resultStoragePath: storagePath,
            creditsSpent: status.credits ?? gen.creditsSpent,
          })
          .where(eq(generations.id, gen.id));
        if (gen.shotId) await recalcShotStatus(gen.shotId);
      } else {
        await db
          .update(generations)
          .set({
            status: status.status === "cancelled" ? "failed" : status.status,
            error:
              status.status === "cancelled" ? "Задача отменена" : (status.error ?? "Отказ провайдера"),
            creditsSpent: status.credits ?? gen.creditsSpent,
          })
          .where(eq(generations.id, gen.id));
        if (gen.shotId) await recalcShotStatus(gen.shotId);
      }
      updated++;
    } catch (e) {
      // сетевые сбои поллинга не роняют цикл; протухшие мок-задачи закрываем
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Мок-задача не найдена")) {
        await db
          .update(generations)
          .set({ status: "failed", error: message })
          .where(eq(generations.id, gen.id));
        if (gen.shotId) await recalcShotStatus(gen.shotId);
        updated++;
      }
    }
  }

  const stillActive = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  return { active: stillActive.length, updated };
}

export async function countActiveGenerations(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  return rows.length;
}
