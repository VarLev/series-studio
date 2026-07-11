/**
 * HiggsfieldMcpProvider — видео-генерация через официальный MCP-сервер
 * mcp.higgsfield.ai на КРЕДИТАХ ПОДПИСКИ (Cloud API — отдельный платный
 * кошелёк, см. providers/higgsfield.ts). Форматы ответов подтверждены живым
 * тестом (2026-07-11, seedance_2_0_mini 4с/480p, 4 кредита):
 *  - generate_video → «Submitted 1 job… \n- <uuid> "prompt"»
 *  - job_status     → «Job <uuid> — in_progress» | «Job <uuid> — completed\n<mp4 url>»
 *  - balance        → «Credits: 563.6 | Plan: ultra»
 */
import type {
  GenerationProvider,
  JobRef,
  JobRequest,
  JobStatus,
  ModelInfo,
  SubmittedJob,
} from "./types";
import { callMcpTool } from "@/lib/higgsfieldMcp";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * job id ТОЛЬКО из подтверждённого формата сабмита
 * («Submitted N job… \n- <uuid> "prompt"») — любой другой UUID в ответе
 * (Request ID, id пресета, воркспейса) job id-ом НЕ считается.
 */
function parseSubmittedJobId(text: string): string | null {
  if (!/submitted\s+\d+\s+job/i.test(text)) return null;
  const dashLine = text.match(/^\s*-\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/im);
  if (dashLine) return dashLine[1];
  const all = [...text.matchAll(new RegExp(UUID_RE.source, "gi"))].map((m) => m[0]);
  return all.length === 1 ? all[0] : null;
}

/** Заказчику нужны Seedance и Kling 3.0 (Omni) — сервисные модели MCP не показываем. */
const VIDEO_WHITELIST = new Set(["seedance_2_0", "seedance_2_0_mini", "kling3_0"]);

/**
 * Роли медиа-входов по модели (models_explore get, 2026-07-12). Seedance держит
 * идентичность персонажей через image_references; Kling их НЕ принимает —
 * только стоп-кадры. Используем, чтобы не слать модели неподдерживаемую роль.
 */
const MEDIA_ROLES: Record<string, string[]> = {
  seedance_2_0: ["start_image", "end_image", "image_references", "video_references", "audio_references"],
  seedance_2_0_mini: ["start_image", "end_image", "image_references", "video_references", "audio_references"],
  kling3_0: ["start_image", "end_image"],
};

/** Сколько референсов-идентичности максимум крепим к задаче (баланс качества/лимитов). */
const MAX_IDENTITY_REFS = 4;

/**
 * Сид каталога — снят с живого MCP (models_explore, 2026-07-11). Сеть до
 * *.higgsfield.ai флапает (DNS-перехват), поэтому каталог не должен зависеть
 * от неё: live-ответ обновляет данные, при сбое работаем на этом сиде.
 */
export const MCP_CATALOG_SEED: ModelInfo[] = [
  {
    id: "kling3_0",
    name: "Kling 3.0 Omni", // так модель называется в UI Higgsfield; референсы — через Elements
    kind: "video",
    params: {
      duration: "3-15",
      mode: ["std", "pro", "4k"],
      sound: ["on", "off"],
      aspect_ratio: ["16:9", "9:16", "1:1"],
      start_image: "media",
      end_image: "media",
    },
    credits: 10, // 5с std (живой get_cost)
  },
  {
    id: "seedance_2_0",
    name: "Seedance 2.0",
    kind: "video",
    params: {
      duration: "4-15",
      resolution: ["480p", "720p", "1080p", "4k"],
      mode: ["std", "fast"],
      genre: ["auto", "action", "horror", "comedy", "noir", "drama", "epic"],
      generate_audio: "bool",
      aspect_ratio: ["auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      start_image: "media",
      end_image: "media",
    },
    credits: 22.5, // 5с std 720p (живой get_cost 2026-07-12: 9с 720p = 40.5, 10с 1080p = 90)
  },
  {
    id: "seedance_2_0_mini",
    name: "Seedance 2.0 Mini",
    kind: "video",
    params: {
      duration: "4-15",
      resolution: ["480p", "720p"],
      genre: ["auto", "action", "horror", "comedy", "noir", "drama", "epic"],
      generate_audio: "bool",
      aspect_ratio: ["auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      start_image: "media",
    },
    credits: 12.5, // 5с 720p (живой get_cost 2026-07-12: 9с 720p = 22.5, 4с 480p = 4)
  },
];

interface McpModelItem {
  id: string;
  name: string;
  output_type: string;
  parameters?: Array<{ name: string; options?: unknown[]; min?: number; max?: number; default?: unknown }>;
  aspect_ratios?: string[];
  durations?: number[];
  duration_range?: { min: number; max: number };
}

export class HiggsfieldMcpProvider implements GenerationProvider {
  name = "higgsfield-mcp";

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await callMcpTool(
        "models_explore",
        { action: "list", type: "video", limit: 100 },
        { retry: true },
      );
      const parsed = JSON.parse(res.text) as { items?: McpModelItem[] };
      const items = (parsed.items ?? []).filter((m) => VIDEO_WHITELIST.has(m.id));
      if (!items.length) return MCP_CATALOG_SEED;
      return items.map((m) => {
        const params: Record<string, unknown> = {};
        for (const p of m.parameters ?? []) {
          params[p.name] = p.options ?? (p.min != null ? `${p.min}-${p.max}` : "any");
        }
        if (m.aspect_ratios) params.aspect_ratio = m.aspect_ratios;
        if (m.durations) params.duration = m.durations;
        if (m.duration_range) params.duration = `${m.duration_range.min}-${m.duration_range.max}`;
        const seed = MCP_CATALOG_SEED.find((s) => s.id === m.id);
        return {
          id: m.id,
          // имя из сида приоритетнее серверного («Kling v3.0» → «Kling 3.0 Omni»)
          name: seed?.name ?? m.name,
          kind: "video" as const,
          params,
          credits: seed?.credits ?? null,
        };
      });
    } catch {
      // сеть до Higgsfield лежит — каталог из сида, обновится следующей кнопкой
      return MCP_CATALOG_SEED;
    }
  }

  async submit(job: JobRequest): Promise<SubmittedJob> {
    const params: Record<string, unknown> = {
      model: job.model,
      // у generate_video нет negative_prompt — вписываем запреты в конец промпта
      prompt: job.negativePrompt ? `${job.prompt}\n\nAvoid: ${job.negativePrompt}` : job.prompt,
      ...job.params,
    };
    const roles = MEDIA_ROLES[job.model] ?? ["start_image", "end_image"];
    const medias: Array<{ value: string; role: string }> = [];
    if (job.startImageUrl && roles.includes("start_image")) {
      medias.push({ value: await this.resolveMedia(job.startImageUrl), role: "start_image" });
    }
    if (job.endImageUrl && roles.includes("end_image")) {
      medias.push({ value: await this.resolveMedia(job.endImageUrl), role: "end_image" });
    }
    // референсы-идентичности персонажей (лица из библии) — только если модель
    // принимает image_references (Seedance да, Kling нет: он держит образ иначе)
    if (job.characterRefUrls?.length && roles.includes("image_references")) {
      for (const url of job.characterRefUrls.slice(0, MAX_IDENTITY_REFS)) {
        medias.push({ value: await this.resolveMedia(url), role: "image_references" });
      }
    }
    if (medias.length) params.medias = medias;

    let res = await callMcpTool("generate_video", { params });
    if (res.isError) throw new Error(`Higgsfield MCP: ${res.text.slice(0, 300)}`);
    let jobId = parseSubmittedJobId(res.text);
    // Сервер может вместо сабмита вернуть рекомендацию пресета (инцидент
    // 2026-07-11: её UUID парсился как job id → зомби-задачи). Отклоняем
    // пресет и повторяем ОДИН раз — только если сабмита точно не было.
    if (!jobId && !/submit/i.test(res.text) && /preset/i.test(res.text)) {
      const presetId = res.text.match(UUID_RE)?.[0];
      if (presetId) {
        res = await callMcpTool("generate_video", {
          params: { ...params, declined_preset_id: presetId },
        });
        if (res.isError) throw new Error(`Higgsfield MCP: ${res.text.slice(0, 300)}`);
        jobId = parseSubmittedJobId(res.text);
      }
    }
    if (!jobId) {
      throw new Error(`Higgsfield не принял задачу (job id не выдан). Ответ: ${res.text.slice(0, 300)}`);
    }
    // Контрольный job_status — только доп. сигнал. Задача УЖЕ создана и оплачена
    // (строгий формат «Submitted N job»), поэтому сбой проверки НЕ фатален:
    // бросать здесь = потерять учёт оплаченной задачи (инцидент 2026-07-12).
    await callMcpTool("job_status", { jobId }, { retry: true }).catch(() => {});
    return { jobId };
  }

  /** media_id (UUID) отдаём как есть; https-URL импортируем в хранилище Higgsfield. */
  private async resolveMedia(urlOrId: string): Promise<string> {
    if (!/^https?:\/\//i.test(urlOrId) && UUID_RE.test(urlOrId)) return urlOrId;
    const res = await callMcpTool("media_import_url", { url: urlOrId, type: "image" }, { retry: true });
    const id = res.text.match(UUID_RE)?.[0];
    if (!id) throw new Error(`media_import_url не вернул media_id: ${res.text.slice(0, 200)}`);
    return id;
  }

  async getStatus(ref: JobRef): Promise<JobStatus> {
    const res = await callMcpTool("job_status", { jobId: ref.jobId }, { retry: true });
    const t = res.text;
    if (res.isError) {
      // сервер задачу не знает → отказ; иначе (внутренний сбой) — бросаем,
      // поллер запишет ошибку связи и покажет её на карточке (не «вечная очередь»)
      if (/not.?found|unknown|invalid/i.test(t)) {
        return { status: "failed", resultUrls: [], error: `Higgsfield не знает задачу: ${t.slice(0, 250)}` };
      }
      throw new Error(`job_status: ${t.slice(0, 250)}`);
    }
    const urls = [...t.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
    if (/completed/i.test(t)) return { status: "done", resultUrls: urls, credits: null };
    if (/nsfw|ip_detected/i.test(t))
      return { status: "nsfw", resultUrls: [], error: t.slice(0, 300) };
    if (/failed|error/i.test(t)) return { status: "failed", resultUrls: [], error: t.slice(0, 300) };
    if (/in_progress|running|processing/i.test(t)) return { status: "running", resultUrls: [] };
    return { status: "queued", resultUrls: [] };
  }

  /** Локальный файл → media_upload (presigned PUT) → media_confirm → {media_id, https-URL}. */
  async uploadMedia(data: Buffer, contentType: string): Promise<{ id: string; url: string }> {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const res = await callMcpTool(
      "media_upload",
      { method: "upload_url", filename: `ref.${ext}`, content_type: contentType },
      { retry: true },
    );
    const uploadUrl = res.text.match(/https?:\/\/[^\s"']+/)?.[0];
    const mediaId = res.text.match(UUID_RE)?.[0];
    if (!uploadUrl || !mediaId) {
      throw new Error(`media_upload: не нашёл upload_url/media_id: ${res.text.slice(0, 300)}`);
    }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(data),
    });
    if (!put.ok) throw new Error(`media upload PUT: ${put.status}`);
    const confirm = await callMcpTool("media_confirm", { type: "image", media_id: mediaId }, { retry: true });
    if (confirm.isError) throw new Error(`media_confirm: ${confirm.text.slice(0, 200)}`);
    // presigned PUT URL без query = постоянный https-адрес медиа (нужен Elements)
    return { id: mediaId, url: uploadUrl.split("?")[0] };
  }

  async uploadFile(data: Buffer, contentType: string): Promise<string> {
    return (await this.uploadMedia(data, contentType)).id;
  }

  /**
   * Reference Element — именованный многоразовый персонаж воркспейса Higgsfield.
   * В промпте на него ссылаются плейсхолдером <<<element_id>>>; работает и с
   * Seedance 2.0, и с Kling 3.0 (Omni) — подтверждено живыми сабмитами 2026-07-12.
   */
  async createElement(name: string, mediaId: string, mediaUrl: string): Promise<string> {
    const res = await callMcpTool("show_reference_elements", {
      action: "create",
      name: name.slice(0, 32),
      category: "character",
      medias: [{ id: mediaId, url: mediaUrl, type: "media_input" }],
    });
    if (res.isError) throw new Error(`element create: ${res.text.slice(0, 250)}`);
    // формат: «Created character "Simon" (<uuid>). Status: completed…»
    const id = res.text.match(UUID_RE)?.[0];
    if (!id) throw new Error(`element create: id не найден: ${res.text.slice(0, 250)}`);
    return id;
  }

  /**
   * Точная стоимость генерации в кредитах подписки (get_cost — job не
   * создаётся, поэтому retry безопасен). Живой формат: «Cost preflight for
   * seedance_2_0_mini: 22.5 credits (22.5 exact). No job submitted.»
   */
  async preflightCost(params: Record<string, unknown>): Promise<number | null> {
    try {
      const res = await callMcpTool(
        "generate_video",
        { params: { ...params, get_cost: true } },
        { retry: true },
      );
      if (res.isError) return null;
      const m = res.text.match(/([\d.]+)\s*credits/i);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }
}
