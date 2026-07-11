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

/** Заказчику нужны Seedance и Kling 3.0 (Omni) — сервисные модели MCP не показываем. */
const VIDEO_WHITELIST = new Set(["seedance_2_0", "seedance_2_0_mini", "kling3_0"]);

/**
 * Сид каталога — снят с живого MCP (models_explore, 2026-07-11). Сеть до
 * *.higgsfield.ai флапает (DNS-перехват), поэтому каталог не должен зависеть
 * от неё: live-ответ обновляет данные, при сбое работаем на этом сиде.
 */
export const MCP_CATALOG_SEED: ModelInfo[] = [
  {
    id: "kling3_0",
    name: "Kling 3.0",
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
    credits: 45, // 5с std 720p (живой get_cost: fast 17.5, std 1080p 10с = 90)
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
    credits: 5, // 4с 480p = 4 (живой get_cost)
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
          name: m.name,
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
    const medias: Array<{ value: string; role: string }> = [];
    if (job.startImageUrl) {
      medias.push({ value: await this.resolveMedia(job.startImageUrl), role: "start_image" });
    }
    if (job.endImageUrl) {
      medias.push({ value: await this.resolveMedia(job.endImageUrl), role: "end_image" });
    }
    if (medias.length) params.medias = medias;

    const res = await callMcpTool("generate_video", { params });
    if (res.isError) throw new Error(`Higgsfield MCP: ${res.text.slice(0, 300)}`);
    const jobId = res.text.match(UUID_RE)?.[0];
    if (!jobId) throw new Error(`Higgsfield MCP не вернул job id: ${res.text.slice(0, 200)}`);
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
    const urls = [...t.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
    if (/completed/i.test(t)) return { status: "done", resultUrls: urls, credits: null };
    if (/nsfw|ip_detected/i.test(t))
      return { status: "nsfw", resultUrls: [], error: t.slice(0, 300) };
    if (/failed|error/i.test(t)) return { status: "failed", resultUrls: [], error: t.slice(0, 300) };
    if (/in_progress|running|processing/i.test(t)) return { status: "running", resultUrls: [] };
    return { status: "queued", resultUrls: [] };
  }

  /** Локальный файл (start-frame) → media_upload (presigned PUT) → media_confirm → media_id. */
  async uploadFile(data: Buffer, contentType: string): Promise<string> {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const res = await callMcpTool(
      "media_upload",
      { method: "upload_url", filename: `start-frame.${ext}`, content_type: contentType },
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
    return mediaId;
  }

  /** Точная стоимость генерации в кредитах подписки (get_cost, job не создаётся). */
  async preflightCost(params: Record<string, unknown>): Promise<number | null> {
    try {
      const res = await callMcpTool("generate_video", { params: { ...params, get_cost: true } });
      const m = res.text.match(/([\d.]+)\s*credits/i);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }
}
