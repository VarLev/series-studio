/**
 * MockProvider — локальная проверка конвейера без ключа Higgsfield.
 * Активен, когда HIGGSFIELD_API_KEY не задан (или HIGGSFIELD_MOCK=1).
 * Задача «генерируется» ~12 секунд, результат — сэмпл public/mock/sample.mp4.
 */
import path from "node:path";
import fs from "node:fs/promises";
import type {
  GenerationProvider,
  JobRef,
  JobRequest,
  JobStatus,
  ModelInfo,
  SubmittedJob,
} from "./types";
import { CATALOG_SEED } from "./higgsfield";

interface MockJob {
  createdAt: number;
  model: string;
  fail: boolean;
  isImage: boolean;
}

type GlobalWithJobs = typeof globalThis & { __ssMockJobs?: Map<string, MockJob> };

function jobs(): Map<string, MockJob> {
  const g = globalThis as GlobalWithJobs;
  if (!g.__ssMockJobs) g.__ssMockJobs = new Map();
  return g.__ssMockJobs;
}

const MOCK_CREDITS: Record<string, number> = {
  kling3_0: 35,
  kling3_0_turbo: 20,
  kling2_6: 25,
  seedance_2_0: 30,
  seedance_2_0_fast: 18,
  seedance_2_0_mini: 12,
  nano_banana_2: 4,
  gpt_image_2: 6,
};

export class MockProvider implements GenerationProvider {
  name = "mock";

  async listModels(): Promise<ModelInfo[]> {
    return CATALOG_SEED.map((m) => ({ ...m, credits: MOCK_CREDITS[m.id] ?? 10 }));
  }

  async submit(job: JobRequest): Promise<SubmittedJob> {
    const jobId = `mock-${crypto.randomUUID()}`;
    // промпт со словом "fail"/"nsfw" — искусственный отказ (для проверки error-path)
    const fail = /\b(fail|nsfw)\b/i.test(job.prompt);
    const isImage = CATALOG_SEED.find((m) => m.id === job.model)?.kind === "image";
    jobs().set(jobId, { createdAt: Date.now(), model: job.model, fail, isImage });
    return { jobId };
  }

  async getStatus(ref: JobRef): Promise<JobStatus> {
    const job = jobs().get(ref.jobId);
    if (!job) return { status: "failed", resultUrls: [], error: "Мок-задача не найдена (сервер перезапускался)" };
    const elapsed = Date.now() - job.createdAt;
    if (elapsed < 3000) return { status: "queued", resultUrls: [] };
    if (elapsed < 12000) return { status: "running", resultUrls: [] };
    if (job.fail) {
      return {
        status: "nsfw",
        resultUrls: [],
        error: "Мок-отказ контент-фильтра (в промпте есть слово fail/nsfw)",
      };
    }
    return {
      status: "done",
      resultUrls: [job.isImage ? "mock://sample-image" : "mock://sample"],
      credits: MOCK_CREDITS[job.model] ?? 10,
    };
  }

  async cancel(ref: JobRef): Promise<void> {
    jobs().delete(ref.jobId);
  }
}

/** Читает байты мок-результата (используется вместо скачивания с CDN). */
export async function readMockSample(): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), "public", "mock", "sample.mp4"));
}

export async function readMockImage(): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), "public", "mock", "sample-image.jpg"));
}
