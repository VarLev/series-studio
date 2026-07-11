/**
 * HiggsfieldProvider — Cloud API (platform.higgsfield.ai).
 *
 * По живой документации (июль 2026, TZ §0.1):
 *  - auth: заголовок `Authorization: Key <key>` (ключ HF_KEY выдаётся в формате
 *    `key:secret` — кладётся в HIGGSFIELD_API_KEY целиком; подтверждено исходниками SDK);
 *  - submit: POST {BASE}/{model_id} c JSON-аргументами → {request_id, status_url,
 *    cancel_url}; model_id = namespaced слаг (проверено живым API);
 *    подтверждённые видео-слаги: kling-video/v3.0/pro/image-to-video,
 *    kling-video/v3.0/std/image-to-video, kling-video/v3.0/pro/text-to-video,
 *    kling-video/v2.1/pro/image-to-video (для Kling 3.0 "omni"-тира в API нет);
 *  - status: GET status_url → status: Queued|InProgress|Completed|Failed|NSFW|Cancelled;
 *  - cancel: POST cancel_url;
 *  - файлы: POST {BASE}/files/generate-upload-url → {upload_url, public_url}, затем PUT байтов;
 *  - каталог: GET {BASE}/models (если недоступен — сид из MODELS.md, обновляемый в БД).
 */
import type {
  GenerationProvider,
  JobRef,
  JobRequest,
  JobStatus,
  ModelInfo,
  SubmittedJob,
} from "./types";

const BASE_URL = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";

/**
 * Сид каталога из официального MODELS.md (github.com/higgsfield-ai/cli) —
 * используется только если endpoint каталога недоступен; хранится в БД
 * и обновляется кнопкой (TZ §0.2).
 */
export const CATALOG_SEED: ModelInfo[] = [
  {
    id: "kling3_0",
    name: "Kling 3.0",
    kind: "video",
    params: {
      aspect_ratio: ["16:9", "9:16", "1:1"],
      duration: "integer",
      mode: ["std", "pro", "4k"],
      sound: ["on", "off"],
      start_image: "uuid|url",
      end_image: "uuid|url",
    },
  },
  {
    id: "kling3_0_turbo",
    name: "Kling 3.0 Turbo",
    kind: "video",
    params: {
      aspect_ratio: ["16:9", "9:16", "1:1"],
      duration: "integer",
      sound: ["on", "off"],
      start_image: "uuid|url",
    },
  },
  {
    id: "kling2_6",
    name: "Kling 2.6",
    kind: "video",
    params: {
      aspect_ratio: ["16:9", "9:16", "1:1"],
      duration: [5, 10],
      sound: "boolean",
      start_image: "uuid|url",
    },
  },
  {
    id: "seedance_2_0",
    name: "Seedance 2.0",
    kind: "video",
    params: {
      aspect_ratio: ["auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      duration: "integer",
      mode: ["std", "fast"],
      resolution: ["480p", "720p", "1080p", "4k"],
      start_image: "uuid|url",
      end_image: "uuid|url",
    },
  },
  {
    // виртуальная строка каталога: провайдеру уходит seedance_2_0 c mode=fast
    // (быстрее и дешевле стандартного режима)
    id: "seedance_2_0_fast",
    name: "Seedance 2.0 Fast",
    kind: "video",
    params: {
      aspect_ratio: ["auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
      duration: "integer",
      resolution: ["480p", "720p", "1080p"],
      start_image: "uuid|url",
      end_image: "uuid|url",
    },
  },
  {
    id: "seedance_2_0_mini",
    name: "Seedance 2.0 Mini",
    kind: "video",
    params: {
      aspect_ratio: ["auto", "16:9", "9:16", "1:1"],
      duration: "integer",
      resolution: ["480p", "720p", "1080p"],
      start_image: "uuid|url",
    },
  },
  {
    id: "nano_banana_2",
    name: "Nano Banana Pro",
    kind: "image",
    params: {
      aspect_ratio: ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"],
      resolution: ["1k", "2k", "4k"],
      image_references: "uuid|url (max 14)",
    },
  },
  {
    id: "gpt_image_2",
    name: "GPT Image 2",
    kind: "image",
    params: {
      aspect_ratio: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
      quality: ["low", "medium", "high"],
      resolution: ["1k", "2k", "4k"],
      image_references: "uuid|url",
    },
  },
];

function authHeader(): string {
  const key = process.env.HIGGSFIELD_API_KEY;
  const secret = process.env.HIGGSFIELD_API_SECRET;
  if (!key) throw new Error("HIGGSFIELD_API_KEY не задан");
  return `Key ${secret ? `${key}:${secret}` : key}`;
}

async function hfFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

function mapStatus(raw: string): JobStatus["status"] {
  switch ((raw || "").toLowerCase()) {
    case "queued":
      return "queued";
    case "inprogress":
    case "in_progress":
    case "processing":
      return "running";
    case "completed":
      return "done";
    case "nsfw":
      return "nsfw";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "failed";
  }
}

type Json = Record<string, unknown>;

/** Результаты приходят как {videos|images: [{url}]} либо {video: {url}} — собираем всё. */
function extractResultUrls(body: Json): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("http")) urls.push(v);
    else if (v && typeof v === "object" && typeof (v as Json).url === "string") {
      urls.push((v as { url: string }).url);
    }
  };
  for (const key of ["videos", "images", "results", "outputs"]) {
    const arr = body[key];
    if (Array.isArray(arr)) arr.forEach(push);
  }
  for (const key of ["video", "image", "result", "output", "url"]) push(body[key]);
  const nested = body["response"] ?? body["data"];
  if (nested && typeof nested === "object" && !urls.length) {
    urls.push(...extractResultUrls(nested as Json));
  }
  return [...new Set(urls)];
}

function extractCredits(body: Json): number | null {
  for (const key of ["credits", "credits_spent", "cost", "credit_cost"]) {
    const v = body[key];
    if (typeof v === "number") return v;
  }
  return null;
}

export class HiggsfieldProvider implements GenerationProvider {
  name = "higgsfield";

  async listModels(): Promise<ModelInfo[]> {
    for (const path of ["/models", "/v1/models"]) {
      try {
        const res = await hfFetch(`${BASE_URL}${path}`);
        const body = (await res.json()) as Json;
        const list = (Array.isArray(body) ? body : (body.models ?? body.data)) as Json[];
        if (Array.isArray(list) && list.length) {
          return list.map((m) => ({
            id: String(m.id ?? m.name),
            name: String(m.display_name ?? m.title ?? m.name ?? m.id),
            kind: String(m.kind ?? m.type ?? "video").includes("image") ? "image" : "video",
            params: (m.params ?? m.parameters ?? {}) as Record<string, unknown>,
            credits:
              typeof m.credits === "number" ? m.credits : typeof m.cost === "number" ? m.cost : null,
          }));
        }
      } catch {
        // каталог недоступен на этом пути — пробуем следующий / сид
      }
    }
    return CATALOG_SEED;
  }

  async submit(job: JobRequest): Promise<SubmittedJob> {
    const args: Json = { prompt: job.prompt, ...job.params };
    if (job.negativePrompt) args.negative_prompt = job.negativePrompt;
    if (job.startImageUrl) args.start_image = job.startImageUrl;
    if (job.endImageUrl) args.end_image = job.endImageUrl;
    if (job.referenceUrls?.length) args.image_references = job.referenceUrls;
    if (job.webhookUrl) args.webhook_url = job.webhookUrl;

    // submit: POST {BASE}/{model_id} напрямую (подтверждено живым API + доками:
    // docs.higgsfield.ai/docs/how-to/introduction). model_id — namespaced слаг
    // из каталога, напр. kling-video/v3.0/pro/image-to-video
    const res = await hfFetch(`${BASE_URL}/${job.model}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    const body = (await res.json()) as Json;
    const jobId = String(body.request_id ?? body.id ?? "");
    if (!jobId) throw new Error(`Higgsfield не вернул request_id: ${JSON.stringify(body).slice(0, 200)}`);
    return {
      jobId,
      statusUrl: typeof body.status_url === "string" ? body.status_url : undefined,
      cancelUrl: typeof body.cancel_url === "string" ? body.cancel_url : undefined,
    };
  }

  async getStatus(ref: JobRef): Promise<JobStatus> {
    const url = ref.statusUrl || `${BASE_URL}/requests/${ref.jobId}/status`;
    const res = await hfFetch(url);
    const body = (await res.json()) as Json;
    const status = mapStatus(String(body.status ?? ""));
    return {
      status,
      resultUrls: status === "done" ? extractResultUrls(body) : [],
      credits: extractCredits(body),
      error:
        status === "failed" || status === "nsfw"
          ? String(body.error ?? body.detail ?? body.message ?? "Провайдер вернул отказ")
          : undefined,
    };
  }

  async cancel(ref: JobRef): Promise<void> {
    const url = ref.cancelUrl || `${BASE_URL}/requests/${ref.jobId}/cancel`;
    await hfFetch(url, { method: "POST" });
  }

  async uploadFile(data: Buffer, contentType: string): Promise<string> {
    const res = await hfFetch(`${BASE_URL}/files/generate-upload-url`, {
      method: "POST",
      body: JSON.stringify({ content_type: contentType }),
    });
    const body = (await res.json()) as { upload_url: string; public_url: string };
    const put = await fetch(body.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(data),
    });
    if (!put.ok) throw new Error(`Higgsfield upload failed: ${put.status}`);
    return body.public_url;
  }
}
