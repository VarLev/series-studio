/**
 * KlingMcpProvider — генерация через официальный Kling MCP (kling.ai/mcp)
 * на ПЛАТНЫХ КРЕДИТАХ ПОДПИСКИ Kling. Формы вызовов сняты live 2026-07-12:
 *  - image_to_video {model, arguments:[{name,value:string}], inputs:[{inputType:"URL",name:"image_N",url}]}
 *    → generation_id; поллинг query_tasks {generationId} → works[].url (живут 24 ч).
 *  - file_upload {filename, contentType, size} → ticket+upload_url →
 *    POST multipart (ticket, file) → URL файла.
 * Preflight-стоимости у Kling НЕТ («Every job is charged») — оценка на карточке
 * приблизительная/неизвестная до первого прогона.
 */
import type {
  GenerationProvider,
  JobRef,
  JobRequest,
  JobStatus,
  ModelInfo,
  SubmittedJob,
} from "./types";
import { callKlingTool } from "@/lib/klingMcp";

/**
 * Каталог из who_am_i (2026-07-12). Заказчику нужен Omni — единственная
 * модель Kling с мульти-референсами (image_1..image_7, в промпте 图片N).
 */
export const KLING_CATALOG_SEED: ModelInfo[] = [
  {
    id: "kling-video-v3_0_omni",
    name: "Kling 3.0 Omni",
    kind: "video",
    params: {
      duration: "3-15",
      resolution: ["720p", "1080p", "4k"],
      aspect_ratio: ["16:9", "9:16", "1:1"],
      reference_images: "1-7 (image_1 обязателен; в промпте 图片1..图片7)",
    },
    // у Kling нет get_cost; эмпирически (2026-07-12): 4с 720p с 2 референсами
    // = 24 кредита → ~6 кр/сек → база 30 за 5с 720p (оценка «≈»)
    credits: 30,
  },
];

/** JSON из текстового ответа инструмента (Kling отвечает JSON-текстом). */
function parseJson<T>(res: { text: string; structured?: unknown }): T | null {
  if (res.structured && typeof res.structured === "object") return res.structured as T;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}

export class KlingMcpProvider implements GenerationProvider {
  name = "kling-mcp";

  async listModels(): Promise<ModelInfo[]> {
    return KLING_CATALOG_SEED;
  }

  async submit(job: JobRequest): Promise<SubmittedJob> {
    // референсы: стартовый кадр (если есть) занимает image_1, дальше персонажи
    const urls = [job.startImageUrl, ...(job.characterRefUrls ?? [])].filter(
      (u): u is string => Boolean(u),
    );
    if (!urls.length) {
      throw new Error(
        "Kling Omni требует хотя бы один референс (image_1): добавьте персонажу фото-образ в библии или выберите start-frame",
      );
    }
    const q = String(job.params.resolution ?? "720p");
    const args = [
      {
        name: "prompt",
        // без «Avoid: …»-хвоста из негатива: модерация читает его как позитивный
        // текст (инцидент 2026-07-19 на higgsfield-mcp, здесь тот же риск)
        value: job.prompt,
      },
      { name: "duration", value: String(job.params.duration ?? 5) },
      { name: "aspect_ratio", value: String(job.params.aspect_ratio ?? "9:16") },
      // ВАЖНО: дефолт Omni — 4k (дорого); всегда передаём выбранное качество
      { name: "resolution", value: q === "480p" ? "720p" : q },
      { name: "imageCount", value: "1" },
      // нативный звук Omni: реплики в кавычках (липсинк), эмбиент и SFX из промпта
      { name: "enable_audio", value: "true" },
    ];
    const inputs = urls.slice(0, 7).map((url, i) => ({
      inputType: "URL",
      name: `image_${i + 1}`,
      url,
    }));
    const res = await callKlingTool("image_to_video", { model: job.model, arguments: args, inputs });
    if (res.isError) throw new Error(`Kling MCP: ${res.text.slice(0, 300)}`);
    const parsed = parseJson<{ generationId?: string; generation_id?: string }>(res);
    const jobId =
      parsed?.generationId ??
      parsed?.generation_id ??
      res.text.match(/generation[_\s]?id["'\s:]*([\w-]{8,})/i)?.[1] ??
      null;
    if (!jobId) {
      throw new Error(`Kling не принял задачу (generation_id не выдан). Ответ: ${res.text.slice(0, 300)}`);
    }
    return { jobId };
  }

  async getStatus(ref: JobRef): Promise<JobStatus> {
    const res = await callKlingTool("query_tasks", { generationId: ref.jobId }, { retry: true });
    const t = res.text;
    if (res.isError) {
      if (/not.?found|unknown|invalid/i.test(t)) {
        return { status: "failed", resultUrls: [], error: `Kling не знает задачу: ${t.slice(0, 250)}` };
      }
      throw new Error(`query_tasks: ${t.slice(0, 250)}`);
    }
    // works[].url — берём видео-URL; статусы в ответе текстом/JSON
    const parsed = parseJson<{ status?: string; works?: Array<{ url?: string; coverUrl?: string }> }>(res);
    const urls = [
      ...(parsed?.works ?? []).map((w) => w.url).filter((u): u is string => Boolean(u)),
      ...[...t.matchAll(/https?:\/\/[^\s"',)]+\.mp4[^\s"',)]*/g)].map((m) => m[0]),
    ];
    const status = (parsed?.status ?? t).toLowerCase();
    if (/succeed|success|completed|finish/.test(status) || urls.length) {
      return { status: "done", resultUrls: [...new Set(urls)], credits: null };
    }
    if (/moderation|risk|sensitive|blocked/.test(status)) {
      return { status: "nsfw", resultUrls: [], error: t.slice(0, 300) };
    }
    if (/failed|error|reject/.test(status)) {
      return { status: "failed", resultUrls: [], error: t.slice(0, 300) };
    }
    if (/processing|running|generating/.test(status)) return { status: "running", resultUrls: [] };
    return { status: "queued", resultUrls: [] };
  }

  /** file_upload → одноразовый тикет → POST multipart (ticket+file) → URL файла. */
  async uploadMedia(data: Buffer, contentType: string): Promise<{ id: string; url: string }> {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const res = await callKlingTool(
      "file_upload",
      { filename: `ref.${ext}`, contentType, size: data.length },
      { retry: true },
    );
    if (res.isError) throw new Error(`file_upload: ${res.text.slice(0, 250)}`);
    const parsed = parseJson<{ ticket?: string; upload_url?: string; uploadUrl?: string }>(res);
    const ticket = parsed?.ticket ?? res.text.match(/"ticket"\s*:\s*"([^"]+)"/)?.[1];
    const uploadUrl =
      parsed?.upload_url ?? parsed?.uploadUrl ?? res.text.match(/https?:\/\/[^\s"']+/)?.[0];
    if (!ticket || !uploadUrl) {
      throw new Error(`file_upload: не нашёл ticket/upload_url: ${res.text.slice(0, 300)}`);
    }
    const form = new FormData();
    form.append("ticket", ticket);
    form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), `ref.${ext}`);
    const up = await fetch(uploadUrl, { method: "POST", body: form });
    const body = await up.text();
    if (!up.ok) throw new Error(`file upload POST: ${up.status} ${body.slice(0, 200)}`);
    let fileUrl: string | null = null;
    try {
      const j = JSON.parse(body) as { url?: string; data?: { url?: string } };
      fileUrl = j.url ?? j.data?.url ?? null;
    } catch {}
    fileUrl = fileUrl ?? body.match(/https?:\/\/[^\s"']+/)?.[0] ?? null;
    if (!fileUrl) throw new Error(`file upload: URL не найден в ответе: ${body.slice(0, 300)}`);
    return { id: fileUrl, url: fileUrl };
  }

  async uploadFile(data: Buffer, contentType: string): Promise<string> {
    return (await this.uploadMedia(data, contentType)).id;
  }
}
