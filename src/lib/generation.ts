/**
 * Ядро центра генерации (M4): каталог, постановка видео-задач и задач-референсов,
 * поллинг статусов, приземление результатов (M5). Используется server actions,
 * cron-роутом и вебхуком.
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  getDb,
  entities,
  generations,
  prompts,
  references,
  settings,
  shotEntities,
  shots,
  videoModels,
} from "@/lib/db";
import { stripAt } from "@/lib/entityName";
import {
  availableVideoProviders,
  getImageProvider,
  googleImageConfigured,
  pickVideoProvider,
  videoProviderByName,
  type GenerationProvider,
  type ModelInfo,
} from "@/lib/providers";
import { CATALOG_SEED } from "@/lib/providers/higgsfield";
import { readMockImage, readMockSample } from "@/lib/providers/mock";
import { getFileUrl, putFile, readFile, saveFromUrl } from "@/lib/storage";
import { imageModelMeta, type ImageModelMeta } from "@/lib/imageModels";
import { promptFamily } from "@/lib/llm/models";
import { logModelCall } from "@/lib/modelLog";

// ---------- Каталог моделей (TZ §0.2) ----------

/**
 * Виртуальные модели: в каталоге и UI — отдельная строка, провайдеру уходит
 * базовый id с фиксированными параметрами (Seedance Fast = seedance_2_0 mode=fast).
 */
const VIRTUAL_MODELS: Record<string, { base: string; params: Record<string, string | number> }> = {
  seedance_2_0_fast: { base: "seedance_2_0", params: { mode: "fast" } },
};

export async function refreshCatalog(): Promise<{ count: number; source: string }> {
  const providers = await availableVideoProviders();
  const primary = providers[0];
  const imageProvider = getImageProvider();
  // видео-модели собираются со ВСЕХ подключённых провайдеров (Higgsfield + Kling MCP)
  const videoList: Array<{ model: ModelInfo; provider: string }> = [];
  for (const p of providers) {
    for (const m of (await p.listModels()).filter((x) => x.kind === "video")) {
      videoList.push({ model: m, provider: p.name });
    }
  }
  // виртуальные видео-строки (Seedance Fast) — из сида, если провайдер их не отдал
  for (const seed of CATALOG_SEED) {
    if (VIRTUAL_MODELS[seed.id] && !videoList.some((v) => v.model.id === seed.id)) {
      videoList.push({ model: { ...seed }, provider: primary.name });
    }
  }
  // image-модели берём у image-провайдера (Google при наличии ключа, иначе Higgsfield/мок)
  const imageModelsList =
    imageProvider.name === primary.name
      ? (await primary.listModels()).filter((m) => m.kind === "image")
      : (await imageProvider.listModels()).filter((m) => m.kind === "image");
  const all = [
    ...videoList,
    ...imageModelsList.map((m) => ({ model: m, provider: imageProvider.name })),
  ];

  const db = await getDb();
  // полная пересборка: при смене провайдера (mock → MCP) старые строки каталога
  // (лишние Kling, чужие image-модели) не должны оставаться в выборе
  await db.delete(videoModels);
  let sort = 0;
  for (const { model: m, provider } of all) {
    await db
      .insert(videoModels)
      .values({
        id: m.id,
        name: m.name,
        kind: m.kind,
        provider,
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
          provider,
          paramsJson: JSON.stringify(m.params ?? {}),
          credits: m.credits ?? null,
          fetchedAt: new Date(),
        },
      });
  }
  return {
    count: all.length,
    source: [...new Set([...providers.map((p) => p.name), imageProvider.name])].join("+"),
  };
}

export interface CatalogModel {
  id: string;
  name: string;
  kind: string;
  provider: string;
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
  // подключили/отключили Kling MCP → его модели должны появиться/уйти из каталога
  const { isConnected: klingConnected } = await import("@/lib/klingMcp");
  const klingChanged = (await klingConnected()) !== rows.some((r) => r.provider === "kling-mcp");
  if (!rows.length || missingVirtual || imageProviderChanged || klingChanged) {
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
      provider: r.provider,
      credits: r.credits,
      qualities: r.kind === "video" ? qualitiesFor(r.id, r.paramsJson) : [],
    }));
}

/** Провайдер для конкретной модели каталога (fallback — основной видео-провайдер). */
async function providerForModel(modelId: string, catalog: CatalogModel[]): Promise<GenerationProvider> {
  const row = catalog.find((m) => m.id === modelId);
  if (row?.provider) {
    const p = await videoProviderByName(row.provider);
    if (p) return p;
  }
  return pickVideoProvider();
}

/** Доступные image-модели для пикеров (клиент-безопасные метаданные). */
export async function availableImageModels(): Promise<ImageModelMeta[]> {
  const catalog = await getCatalog("image");
  return catalog
    .map((c) => imageModelMeta(c.id))
    .filter((m): m is ImageModelMeta => Boolean(m));
}

// ---------- Оценка кредитов (spec §3.1) ----------

// коэффициенты сверены с живым get_cost 2026-07-12 (1080p = ×2, 480p ≈ ×0.4)
const QUALITY_COEF: Record<string, number> = { "480p": 0.4, "720p": 1, "1080p": 2 };

/**
 * Оценка-фолбэк = база × (сек/5) × коэф. качества. Реальный прайс Higgsfield
 * сложнее — точную цифру даёт preflightCost (get_cost) перед запуском.
 */
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
  /** здоровье поллинга: время последней попытки + ошибка связи (если была) */
  _poll?: { at: number; error?: string; fails?: number };
  [key: string]: unknown;
}

/**
 * Медиа референса у провайдера: {media_id, https-URL}. Кэшируется в settings —
 * без кэша каждый запуск заново грузил те же мегабайты (12+ секунд на пару
 * референсов) и умножал шансы сетевого флапа.
 */
async function mediaForReference(
  refId: string,
  provider: GenerationProvider,
): Promise<{ id: string; url: string } | null> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return null;
  if (!provider.uploadMedia) return null;
  // v3: поколение ключей сменено 2026-07-12 — старые кэши могли пережить удаление
  // референса (мёртвые ссылки на удалённые изображения), при старте они зачищаются
  const cacheKey = `hf_media3_${provider.name}_${refId}`;
  const [cached] = await db.select().from(settings).where(eq(settings.key, cacheKey));
  if (cached?.value) {
    try {
      return JSON.parse(cached.value) as { id: string; url: string };
    } catch {}
  }
  const data = await readFile(ref.storagePath);
  const contentType = ref.storagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const media = await provider.uploadMedia(data, contentType);
  await db
    .insert(settings)
    .values({ key: cacheKey, value: JSON.stringify(media) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(media) } });
  return media;
}

async function publicUrlForReference(
  refId: string,
  provider?: GenerationProvider,
): Promise<string | null> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return null;
  const p = provider ?? (await pickVideoProvider());
  // Локальный диск недоступен провайдеру извне — передаём байты через его upload API
  // (Cloud API → files/generate-upload-url; MCP → media_upload+confirm → media_id).
  if (!process.env.SUPABASE_URL && p.uploadMedia) {
    return (await mediaForReference(refId, p))?.id ?? null;
  }
  if (!process.env.SUPABASE_URL && p.uploadFile) {
    const data = await readFile(ref.storagePath);
    const contentType = ref.storagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    return p.uploadFile(data, contentType);
  }
  return getFileUrl(ref.storagePath);
}

/**
 * Reference Element персонажа у Higgsfield (именованный, многоразовый):
 * создаётся из фото-образа один раз, id кэшируется. В промпте на элемент
 * ссылаются плейсхолдером <<<element_id>>> — работает и с Seedance, и с Kling.
 */
async function ensureEntityElement(
  entityId: string,
  name: string,
  media: { id: string; url: string },
  provider: GenerationProvider,
): Promise<string | null> {
  const db = await getDb();
  if (!provider.createElement) return null;
  // v2: см. комментарий у hf_media3 — смена поколения после инцидента с кэшем
  const cacheKey = `hf_elem2_${entityId}`;
  const [cached] = await db.select().from(settings).where(eq(settings.key, cacheKey));
  if (cached?.value) return cached.value;
  try {
    const elementId = await provider.createElement(name, media.id, media.url);
    await db
      .insert(settings)
      .values({ key: cacheKey, value: elementId })
      .onConflictDoUpdate({ target: settings.key, set: { value: elementId } });
    return elementId;
  } catch {
    return null; // фолбэк — image_references (Seedance) или без референса (Kling)
  }
}

/**
 * Референсы-идентичности персонажей для видео-задачи: по каким сущностям
 * прикрепить фото-образы из библии. Приоритет — reference_element_names из
 * промпта (кого модель выбрала в кадр); если пусто — все персонажи/пропы,
 * привязанные к шоту (shot_entities). Возвращает пары {имена, URL/медиа-id}.
 */
async function identityRefs(
  shotId: string,
  referenceElementNames: string[],
): Promise<Array<{ entityId: string; elementName: string; name: string; refId: string }>> {
  const db = await getDb();
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  if (!links.length) return [];
  const linked = await db
    .select()
    .from(entities)
    .where(inArray(entities.id, links.map((l) => l.entityId)));

  // выбор сущностей: по именам из промпта (@-нечувствительно) либо все привязанные
  const wanted = new Set(referenceElementNames.map(stripAt).filter(Boolean));
  const chosen = wanted.size
    ? linked.filter((e) => wanted.has(stripAt(e.elementName)) || wanted.has(stripAt(e.name)))
    : linked;
  if (!chosen.length) return [];

  // по одному (лучшему) референсу на сущность, порядок как в reference_element_names
  const order = (e: (typeof chosen)[number]) => {
    const idx = referenceElementNames.findIndex(
      (n) => stripAt(n) === stripAt(e.elementName) || stripAt(n) === stripAt(e.name),
    );
    return idx === -1 ? 999 : idx;
  };
  chosen.sort((a, b) => order(a) - order(b));

  const out: Array<{ entityId: string; elementName: string; name: string; refId: string }> = [];
  for (const e of chosen) {
    const refs = await db
      .select()
      .from(references)
      .where(eq(references.entityId, e.id))
      .orderBy(asc(references.createdAt));
    if (!refs[0]) continue;
    out.push({ entityId: e.id, elementName: e.elementName, name: e.name, refId: refs[0].id });
  }
  return out;
}

/**
 * Подмена упоминаний персонажей в уходящем тексте промпта. Именованные @Simon
 * Higgsfield не резолвит (красные в их UI) — рабочие привязки:
 *  - <<<element_id>>> — reference element (Seedance И Kling 3.0 Omni);
 *  - @imageN — порядковый номер прикреплённого медиа (только Seedance, фолбэк).
 * Сохранённая версия промпта остаётся с читаемыми именами.
 */
export function replaceMentions(
  prompt: string,
  mapping: Array<{ elementName: string; name: string; token: string }>,
  startFrameAttached: boolean,
): string {
  let text = prompt;
  for (const m of mapping) {
    for (const raw of [m.elementName, m.name]) {
      const bare = stripAt(raw);
      if (!bare) continue;
      // @Simon / @simon (граница слова — не захватываем соседние буквы)
      text = text.replace(new RegExp(`@${escapeReg(bare)}(?![\\w-])`, "gi"), m.token);
    }
  }
  if (startFrameAttached) {
    // упоминания стартового кадра из шаблона (@Start; @Image1 уже совпадает)
    text = text.replace(/@start(?![\w-])/gi, "@image1");
  }
  return text;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  // kling3_0 (Higgsfield) принимает mode std/pro; kling-video-* (Kling MCP) — resolution
  if (modelId.startsWith("kling") && !modelId.startsWith("kling-video")) {
    params.mode = quality === "1080p" ? "pro" : "std";
  } else {
    params.resolution = quality;
  }
  return params;
}

export interface SubmitInput {
  shotId: string;
  /** конкретная версия промпта (ретрай); без неё промпт берётся по семейству модели */
  promptId?: string;
  modelIds: string[];
  startFrameRefId?: string;
  durationSec: number;
  aspectRatio: string;
  quality: string;
}

/**
 * Точная стоимость задачи в кредитах у провайдера (get_cost) — задача НЕ
 * создаётся. null — провайдер не умеет preflight или сеть недоступна.
 */
export async function preflightJobCost(
  modelId: string,
  durationSec: number,
  aspectRatio: string,
  quality: string,
): Promise<number | null> {
  const catalog = await getCatalog("video");
  const provider = await providerForModel(modelId, catalog);
  if (!provider.preflightCost) return null; // у Kling MCP get_cost нет
  const virtual = VIRTUAL_MODELS[modelId];
  const params = {
    ...shapeVideoParams(modelId, durationSec, aspectRatio, quality),
    ...(virtual?.params ?? {}),
  };
  return provider.preflightCost({ model: virtual?.base ?? modelId, prompt: "cost preflight", ...params });
}

/** Резолв референсов персонажей и start-frame под КОНКРЕТНОГО провайдера. */
interface ProviderCtx {
  startImageUrl?: string;
  resolved: Array<{
    elementName: string;
    name: string;
    media: { id: string; url: string };
    elementId: string | null;
  }>;
  /** композиционные референсы шота (кадрирование/свет/настроение), @Comp1..@CompN */
  compositions: Array<{ media: { id: string; url: string } }>;
}

export async function submitJobs(input: SubmitInput): Promise<{ queued: number }> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, input.shotId));
  if (!shot) throw new Error("Шот не найден");
  const catalog = await getCatalog("video");

  // промпт-треки: у каждой модели — промпт её семейства (Seedance/Kling).
  // Явный promptId (ретрай) побеждает, если его семейство совпадает с моделью.
  const allPrompts = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, input.shotId))
    .orderBy(desc(prompts.version));
  const explicit = input.promptId ? allPrompts.find((p) => p.id === input.promptId) : undefined;
  if (input.promptId && !explicit) throw new Error("Промпт не найден");
  function promptRowFor(modelId: string) {
    const fam = promptFamily(modelId);
    if (explicit && promptFamily(explicit.targetModel) === fam) return explicit;
    const row = allPrompts.find((p) => promptFamily(p.targetModel) === fam);
    if (!row) {
      throw new Error(
        fam === "kling"
          ? "Для Kling нет промпта — создайте его в блоке «Промпт» (вкладка Kling)"
          : "Для Seedance нет промпта — создайте его в блоке «Промпт» (вкладка Seedance)",
      );
    }
    return row;
  }

  // референсы персонажей зависят от reference_element_names конкретного промпта
  const refsCache = new Map<string, Awaited<ReturnType<typeof identityRefs>>>();
  async function refsFor(promptRow: (typeof allPrompts)[number]) {
    const cached = refsCache.get(promptRow.id);
    if (cached) return cached;
    const promptParams = JSON.parse(promptRow.paramsJson || "{}") as {
      reference_element_names?: string[];
    };
    const refs = await identityRefs(input.shotId, promptParams.reference_element_names ?? []);
    refsCache.set(promptRow.id, refs);
    return refs;
  }

  // медиа/элементы загружаются в хранилище КАЖДОГО задействованного провайдера
  // (Higgsfield и Kling — разные аккаунты); кэш по провайдеру×промпту
  const ctxCache = new Map<string, ProviderCtx>();
  async function ctxFor(
    provider: GenerationProvider,
    promptRow: (typeof allPrompts)[number],
  ): Promise<ProviderCtx> {
    const cacheKey = `${provider.name}:${promptRow.id}`;
    const cached = ctxCache.get(cacheKey);
    if (cached) return cached;
    const refsRaw = await refsFor(promptRow);
    const startImageUrl = input.startFrameRefId
      ? ((await publicUrlForReference(input.startFrameRefId, provider)) ?? undefined)
      : undefined;
    const resolved: ProviderCtx["resolved"] = [];
    for (const r of refsRaw) {
      const media = await mediaForReference(r.refId, provider).catch(() => null);
      if (!media) continue;
      // именованные элементы есть только у Higgsfield; у Kling — image_1..7
      const elementId = await ensureEntityElement(
        r.entityId,
        stripAt(r.elementName) || r.name,
        media,
        provider,
      );
      resolved.push({ elementName: r.elementName, name: r.name, media, elementId });
    }
    // композиционные референсы шота (роль != start_frame) — грузим медиа провайдеру
    const compRows = (
      await db.select().from(references).where(eq(references.shotId, input.shotId)).orderBy(asc(references.createdAt))
    ).filter((r) => r.role !== "start_frame");
    const compositions: ProviderCtx["compositions"] = [];
    for (const c of compRows) {
      const media = await mediaForReference(c.id, provider).catch(() => null);
      if (media) compositions.push({ media });
    }
    const ctx = { startImageUrl, resolved, compositions };
    ctxCache.set(cacheKey, ctx);
    return ctx;
  }

  /**
   * Промпт + медиа-привязки под модель/провайдера:
   *  - kling-mcp: токены <<<image_N>>> (официальный синтаксис Kling 3.0 Omni),
   *    все референсы уходят как image_1..image_7 (start-frame занимает <<<image_1>>>);
   *  - higgsfield: элементы <<<element_id>>>, фолбэк image_references+@imageN
   *    (только Seedance; kling3_0 без элементов референсы не принимает).
   */
  function promptForModel(
    provider: GenerationProvider,
    ctx: ProviderCtx,
    modelId: string,
    promptRow: (typeof allPrompts)[number],
  ): { text: string; refMedias: string[] } {
    const mapping: Array<{ elementName: string; name: string; token: string }> = [];
    const refMedias: string[] = [];
    if (provider.name === "kling-mcp") {
      let slot = ctx.startImageUrl ? 2 : 1; // start-frame = <<<image_1>>>
      for (const r of ctx.resolved) {
        mapping.push({ elementName: r.elementName, name: r.name, token: `<<<image_${slot++}>>>` });
        refMedias.push(r.media.url);
      }
      // композиционные референсы @Comp1.. → следующие слоты картинок
      ctx.compositions.forEach((c, i) => {
        mapping.push({ elementName: `Comp${i + 1}`, name: `Comp${i + 1}`, token: `<<<image_${slot++}>>>` });
        refMedias.push(c.media.url);
      });
      let text = replaceMentions(promptRow.text, mapping, false);
      if (ctx.startImageUrl) text = text.replace(/@start(?![\w-])/gi, "<<<image_1>>>");
      return { text, refMedias };
    }
    const supportsImageRefs = !modelId.startsWith("kling");
    let ordinal = ctx.startImageUrl ? 2 : 1; // start-frame занимает @image1
    for (const r of ctx.resolved) {
      if (r.elementId) {
        mapping.push({ elementName: r.elementName, name: r.name, token: `<<<${r.elementId}>>>` });
      } else if (supportsImageRefs) {
        mapping.push({ elementName: r.elementName, name: r.name, token: `@image${ordinal++}` });
        refMedias.push(r.media.id);
      }
    }
    // композиционные референсы @Comp1.. → @imageN (только Seedance/Higgsfield)
    if (supportsImageRefs) {
      ctx.compositions.forEach((c, i) => {
        mapping.push({ elementName: `Comp${i + 1}`, name: `Comp${i + 1}`, token: `@image${ordinal++}` });
        refMedias.push(c.media.id);
      });
    }
    return { text: replaceMentions(promptRow.text, mapping, Boolean(ctx.startImageUrl)), refMedias };
  }

  // ---------- Фаза 1 (быстро): вставляем "queued"-плейсхолдеры ----------
  // Тяжёлая сеть (загрузка медиа референсов провайдеру, создание element, get_cost,
  // submit) уходит в фон — карточка задачи появляется мгновенно, а её статус
  // меняется в этой же строке по мере отправки и последующего поллинга.
  interface Pending {
    genId: string;
    modelId: string;
    promptRow: (typeof allPrompts)[number];
    quality: string;
    model: CatalogModel | undefined;
  }
  // Фаза 1 — ТОЛЬКО данные из БД-каталога, БЕЗ сети: имя провайдера берём строкой
  // из каталога (не резолвим провайдер-объект, т.к. это дёргает проверку/рефреш
  // токенов Higgsfield/Kling по сети и задерживает появление карточки).
  // Сперва резолвим промпты всех моделей: нет промпта → ошибка ДО любых вставок.
  const plan = input.modelIds.map((modelId) => ({ modelId, promptRow: promptRowFor(modelId) }));
  const pending: Pending[] = [];
  for (const { modelId, promptRow } of plan) {
    const model = catalog.find((m) => m.id === modelId);
    const providerName = model?.provider ?? "higgsfield-mcp";
    const quality = effectiveQuality(modelId, input.quality, model?.qualities ?? []);
    const genId = crypto.randomUUID();
    await db.insert(generations).values({
      id: genId,
      shotId: input.shotId,
      episodeId: shot.episodeId,
      kind: "video",
      promptId: promptRow.id,
      provider: providerName,
      model: modelId,
      paramsJson: JSON.stringify({
        quality,
        start_frame_ref: input.startFrameRefId ?? null,
        character_refs: 0,
        estimate: estimateJobCredits(model?.credits ?? null, input.durationSec, quality),
        estimate_exact: false,
        _pending: { at: Date.now() }, // ждёт фоновой отправки провайдеру
      }),
      status: "queued",
      source: "api",
    });
    pending.push({ genId, modelId, promptRow, quality, model });
  }
  await db.update(shots).set({ status: "generating" }).where(eq(shots.id, input.shotId));

  // ---------- Фаза 2 (фон): отправка провайдеру, обновление той же строки ----------
  async function submitOne(p: Pending): Promise<void> {
    const { genId, modelId, promptRow, quality, model } = p;
    const virtual = VIRTUAL_MODELS[modelId];
    const params = {
      ...shapeVideoParams(modelId, input.durationSec, input.aspectRatio, quality),
      ...(virtual?.params ?? {}),
    };
    const logRefs = [
      ...(input.startFrameRefId ? [{ id: input.startFrameRefId, role: "start_frame" }] : []),
      ...(await refsFor(promptRow).catch(() => [])).map((r) => ({
        id: r.refId,
        caption: r.name,
        role: "character",
      })),
    ];
    try {
      // резолв провайдер-объекта (проверка/рефреш токенов по сети) — уже в фоне
      const provider = await providerForModel(modelId, catalog);
      const ctx = await ctxFor(provider, promptRow);
      const exactCost = provider.preflightCost
        ? await provider
            .preflightCost({ model: virtual?.base ?? modelId, prompt: promptRow.text, ...params })
            .catch(() => null)
        : null;
      const { text: modelPrompt, refMedias } = promptForModel(provider, ctx, modelId, promptRow);
      const logRequest = {
        prompt: modelPrompt,
        negativePrompt: promptRow.negativePrompt ?? "",
        params,
        startFrame: Boolean(ctx.startImageUrl),
        attachedRefs: logRefs.length,
      };
      const submitStarted = Date.now();
      const sub = await provider
        .submit({
          model: virtual?.base ?? modelId,
          prompt: modelPrompt,
          negativePrompt: promptRow.negativePrompt ?? undefined,
          params,
          startImageUrl: ctx.startImageUrl,
          characterRefUrls: refMedias,
        })
        .catch(async (e: unknown) => {
          await logModelCall({
            channel: "video",
            kind: "video",
            provider: provider.name,
            model: modelId,
            status: "error",
            request: logRequest,
            response: { error: e instanceof Error ? e.message : String(e) },
            refs: logRefs,
            durationMs: Date.now() - submitStarted,
            episodeId: shot.episodeId,
            shotId: input.shotId,
          });
          throw e;
        });
      await logModelCall({
        channel: "video",
        kind: "video",
        provider: provider.name,
        model: modelId,
        status: "ok",
        request: logRequest,
        response: { jobId: sub.jobId, statusUrl: sub.statusUrl ?? null },
        refs: logRefs,
        durationMs: Date.now() - submitStarted,
        episodeId: shot.episodeId,
        shotId: input.shotId,
      });
      const paramsJson: UrlBundle = {
        ...params,
        quality,
        start_frame_ref: input.startFrameRefId ?? null,
        character_refs:
          provider.name === "kling-mcp"
            ? refMedias.length
            : ctx.resolved.filter((r) => r.elementId).length + refMedias.length,
        estimate: exactCost ?? estimateJobCredits(model?.credits ?? null, input.durationSec, quality),
        estimate_exact: exactCost != null,
        _urls: { statusUrl: sub.statusUrl, cancelUrl: sub.cancelUrl },
      };
      // _pending исчезает вместе с новым paramsJson → задача перестаёт быть плейсхолдером
      await db
        .update(generations)
        .set({ providerJobId: sub.jobId, paramsJson: JSON.stringify(paramsJson) })
        .where(eq(generations.id, genId));
    } catch (e) {
      await db
        .update(generations)
        .set({ status: "failed", error: e instanceof Error ? e.message : "Не удалось отправить задачу" })
        .where(eq(generations.id, genId));
      await recalcShotStatus(input.shotId);
    }
  }

  // ответ клиенту уже ушёл; отправляем последовательно (один аккаунт провайдера)
  void (async () => {
    for (const p of pending) await submitOne(p);
  })().catch(() => {});

  return { queued: pending.length };
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

  const imgLogRefs = (input.sourceRefIds ?? []).map((id) => ({ id, role: input.sourceTag }));
  const imgLogRequest = {
    prompt: input.prompt,
    params,
    attachedRefs: (input.sourceRefIds ?? []).length,
  };
  const imgStarted = Date.now();
  const sub = await provider
    .submit({
      model: input.model,
      prompt: input.prompt,
      params,
      referenceUrls: referenceUrls.length ? referenceUrls : undefined,
      referenceImages: referenceImages.length ? referenceImages : undefined,
    })
    .catch(async (e: unknown) => {
      await logModelCall({
        channel: "image",
        kind: input.sourceTag,
        provider: provider.name,
        model: input.model,
        status: "error",
        request: imgLogRequest,
        response: { error: e instanceof Error ? e.message : String(e) },
        refs: imgLogRefs,
        durationMs: Date.now() - imgStarted,
        episodeId: input.episodeId,
      });
      throw e;
    });
  await logModelCall({
    channel: "image",
    kind: input.sourceTag,
    provider: provider.name,
    model: input.model,
    status: "ok",
    request: imgLogRequest,
    response: { jobId: sub.jobId, statusUrl: sub.statusUrl ?? null },
    refs: imgLogRefs,
    durationMs: Date.now() - imgStarted,
    episodeId: input.episodeId,
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
  // победителей может быть несколько — approved, если есть хотя бы один готовый
  const hasWinner = gens.some((g) => g.winner && g.status === "done");
  let next: string;
  if (hasWinner) next = "approved";
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
    // image-задачи опрашивает image-провайдер; видео — провайдер задачи
    // (маршрутизация по generations.provider: higgsfield-mcp / kling-mcp / …)
    const provider =
      gen.kind === "reference"
        ? imageProvider
        : ((await videoProviderByName(gen.provider)) ?? videoProvider);
    if (!gen.providerJobId) {
      // плейсхолдер видео-задачи ещё отправляется в фоне (submitJobs). Если завис
      // дольше 3 минут (например, сервер перезапускался в момент отправки) —
      // помечаем ошибкой, чтобы не крутился вечный «в очереди».
      if (gen.kind === "video") {
        const pend = (JSON.parse(gen.paramsJson || "{}") as { _pending?: { at?: number } })._pending;
        if (pend?.at && Date.now() - pend.at > 180_000) {
          await db
            .update(generations)
            .set({ status: "failed", error: "Не удалось отправить задачу — попробуйте ещё раз" })
            .where(eq(generations.id, gen.id));
          if (gen.shotId) await recalcShotStatus(gen.shotId);
          updated++;
        }
      }
      continue;
    }
    if (gen.provider !== provider.name) continue;
    const bundle = JSON.parse(gen.paramsJson || "{}") as UrlBundle;
    try {
      const status = await provider.getStatus({
        jobId: gen.providerJobId,
        statusUrl: bundle._urls?.statusUrl,
        cancelUrl: bundle._urls?.cancelUrl,
      });
      // связь с провайдером ок — снимаем предупреждение, если оно было
      if (bundle._poll?.error) {
        bundle._poll = { at: Date.now() };
        await db
          .update(generations)
          .set({ paramsJson: JSON.stringify(bundle) })
          .where(eq(generations.id, gen.id));
        updated++;
      }
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
      } else {
        // ошибка связи НЕ глотается молча: пишем в _poll — карточка покажет
        // «нет связи с Higgsfield» вместо вечной «очереди» (инцидент 2026-07-11)
        bundle._poll = {
          at: Date.now(),
          error: message.slice(0, 200),
          fails: (bundle._poll?.fails ?? 0) + 1,
        };
        await db
          .update(generations)
          .set({ paramsJson: JSON.stringify(bundle) })
          .where(eq(generations.id, gen.id));
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
