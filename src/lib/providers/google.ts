/**
 * GoogleImageProvider — Nano Banana через Gemini API (generateContent).
 * Синхронный: изображение приходит в ответе (inline base64), поэтому результат
 * приземляется в том же запросе, без поллинга. Оплата — pay-per-use у Google
 * (ключ Google AI Studio, GEMINI_API_KEY), отдельно от кредитов Higgsfield.
 *
 * Модели (ai.google.dev, 2026): gemini-3-pro-image (Pro),
 * gemini-3.1-flash-lite-image (Light), gemini-3.1-flash-image (NB2),
 * gemini-2.5-flash-image (legacy).
 */
import type {
  GenerationProvider,
  JobRef,
  JobRequest,
  JobStatus,
  ModelInfo,
  SubmittedJob,
} from "./types";
import { GOOGLE_IMAGE_MODELS } from "@/lib/imageModels";
import { readMockImage } from "./mock";

const BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

/** Результаты синхронной генерации — в памяти процесса на время одного запроса. */
type GoogleResult = { data: Buffer; mimeType: string; usd: number };
type GlobalWithResults = typeof globalThis & { __ssGoogleResults?: Map<string, GoogleResult> };

function results(): Map<string, GoogleResult> {
  const g = globalThis as GlobalWithResults;
  if (!g.__ssGoogleResults) g.__ssGoogleResults = new Map();
  return g.__ssGoogleResults;
}

function apiModelId(id: string): string {
  return GOOGLE_IMAGE_MODELS.find((m) => m.id === id)?.apiModel ?? id;
}

/** качество приложения (1k|2k|4k) → imageSize Gemini. */
function imageSize(quality: string): string {
  const q = quality.toLowerCase();
  if (q.startsWith("4")) return "4K";
  if (q.startsWith("2")) return "2K";
  return "1K";
}

function usdFor(id: string, quality: string): number {
  const meta = GOOGLE_IMAGE_MODELS.find((m) => m.id === id);
  if (!meta) return 0;
  return meta.cost[quality.toLowerCase()] ?? Object.values(meta.cost)[0] ?? 0;
}

type Json = Record<string, unknown>;

/** Достаёт первую картинку из ответа generateContent (inlineData | inline_data). */
function extractImage(body: Json): { data: string; mimeType: string } | null {
  const candidates = (body.candidates as Json[]) ?? [];
  for (const c of candidates) {
    const parts = ((c.content as Json)?.parts as Json[]) ?? [];
    for (const p of parts) {
      const inline = (p.inlineData ?? p.inline_data) as Json | undefined;
      const data = inline?.data as string | undefined;
      if (data) {
        return { data, mimeType: (inline?.mimeType ?? inline?.mime_type ?? "image/png") as string };
      }
    }
  }
  return null;
}

export class GoogleImageProvider implements GenerationProvider {
  name = "google";
  synchronous = true;

  async listModels(): Promise<ModelInfo[]> {
    return GOOGLE_IMAGE_MODELS.map((m) => ({
      id: m.id,
      name: m.label,
      kind: "image" as const,
      params: {
        aspect_ratio: ["1:1", "9:16", "16:9", "4:3", "3:4", "2:3", "3:2", "21:9"],
        resolution: ["1k", "2k", "4k"],
        image_references: "inline (max 14)",
      },
      credits: null, // оплата в $ у Google, не в кредитах Higgsfield
    }));
  }

  async submit(job: JobRequest): Promise<SubmittedJob> {
    const key = process.env.GEMINI_API_KEY;
    const quality = String(job.params.resolution ?? "1k");

    // мок-режим (GEMINI_MOCK=1 без ключа) — сэмпл-картинка для проверки потока
    if (!key || process.env.GEMINI_MOCK === "1") {
      const jobId = `google-${crypto.randomUUID()}`;
      results().set(jobId, {
        data: await readMockImage(),
        mimeType: "image/jpeg",
        usd: usdFor(job.model, quality),
      });
      return { jobId };
    }

    const model = apiModelId(job.model);
    const aspect = String(job.params.aspect_ratio ?? "1:1");

    const parts: Json[] = [{ text: job.prompt }];
    for (const ref of job.referenceImages ?? []) {
      parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.data } });
    }

    const res = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: aspect, imageSize: imageSize(quality) },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as Json;
    const img = extractImage(body);
    if (!img) {
      // модель могла отказать по контент-фильтру — прокидываем причину
      const reason =
        ((body.promptFeedback as Json)?.blockReason as string) ??
        (((body.candidates as Json[]) ?? [])[0]?.finishReason as string) ??
        "модель не вернула изображение";
      throw new Error(`NSFW:${reason}`);
    }
    const jobId = `google-${crypto.randomUUID()}`;
    results().set(jobId, {
      data: Buffer.from(img.data, "base64"),
      mimeType: img.mimeType,
      usd: usdFor(job.model, quality),
    });
    return { jobId };
  }

  async getStatus(ref: JobRef): Promise<JobStatus> {
    const r = results().get(ref.jobId);
    if (!r) {
      return { status: "failed", resultUrls: [], error: "Результат Google не найден (сервер перезапускался)" };
    }
    return { status: "done", resultUrls: [`google://${ref.jobId}`], credits: null };
  }

  takeResult(jobId: string): { data: Buffer; mimeType: string } | null {
    const r = results().get(jobId);
    if (!r) return null;
    results().delete(jobId);
    return { data: r.data, mimeType: r.mimeType };
  }
}
