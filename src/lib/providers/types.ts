/** Общий интерфейс адаптера генерации (TZ §4 M4). */

export interface ModelInfo {
  id: string; // provider model id, e.g. kling3_0
  name: string;
  kind: "video" | "image";
  /** allowed params / enums, из каталога провайдера */
  params: Record<string, unknown>;
  /** оценка кредитов за задачу, если известна */
  credits?: number | null;
}

export interface JobRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** aspect_ratio, duration, mode, resolution, sound... — как ожидает провайдер */
  params: Record<string, string | number | boolean>;
  /** публичный URL стоп-кадра для image-to-video */
  startImageUrl?: string;
  endImageUrl?: string;
  /** публичные URL референсов (для image-моделей Higgsfield) */
  referenceUrls?: string[];
  /** байты референсов inline (для Google — inline_data) */
  referenceImages?: Array<{ data: string; mimeType: string }>;
  webhookUrl?: string;
}

export interface SubmittedJob {
  jobId: string;
  statusUrl?: string;
  cancelUrl?: string;
}

export type JobState = "queued" | "running" | "done" | "failed" | "nsfw" | "cancelled";

export interface JobStatus {
  status: JobState;
  resultUrls: string[];
  credits?: number | null;
  error?: string;
}

export interface JobRef {
  jobId: string;
  statusUrl?: string;
  cancelUrl?: string;
}

export interface GenerationProvider {
  name: string;
  /** генерация возвращает результат сразу (Google image) — приземляем в том же запросе, без поллинга */
  synchronous?: boolean;
  listModels(): Promise<ModelInfo[]>;
  submit(job: JobRequest): Promise<SubmittedJob>;
  getStatus(ref: JobRef): Promise<JobStatus>;
  cancel?(ref: JobRef): Promise<void>;
  /** загрузить файл провайдеру, вернуть публичный URL/идентификатор для параметров */
  uploadFile?(data: Buffer, contentType: string): Promise<string>;
  /** байты синхронно сгенерированного результата (Google) по jobId */
  takeResult?(jobId: string): { data: Buffer; mimeType: string } | null;
}
