/**
 * Storage abstraction (ADR-001): local disk in dev, Supabase Storage when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. DB stores only storage_path;
 * URLs are always produced server-side (signed for Supabase, authed route locally).
 */
import path from "node:path";
import fs from "node:fs/promises";

const LOCAL_ROOT = () => path.join(process.cwd(), ".data", "storage");
const BUCKET = process.env.SUPABASE_BUCKET || "media";

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function sanitizeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/\.\./g, "");
  return normalized.replace(/^\/+/, "");
}

export async function putFile(key: string, data: Buffer, contentType: string): Promise<string> {
  const safeKey = sanitizeKey(key);
  if (supabaseConfigured()) {
    const supabase = await supabaseClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(safeKey, data, { contentType, upsert: true });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  } else {
    const filePath = path.join(LOCAL_ROOT(), safeKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }
  return safeKey;
}

export async function getFileUrl(storagePath: string): Promise<string> {
  const safeKey = sanitizeKey(storagePath);
  if (supabaseConfigured()) {
    const supabase = await supabaseClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(safeKey, 60 * 60);
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`);
    return data.signedUrl;
  }
  return `/api/files/${safeKey}`;
}

/** Есть ли файл в хранилище (для постеров видео — проверка по конвенции имени). */
export async function fileExists(storagePath: string): Promise<boolean> {
  const safeKey = sanitizeKey(storagePath);
  if (supabaseConfigured()) {
    const supabase = await supabaseClient();
    const slash = safeKey.lastIndexOf("/");
    const dir = slash === -1 ? "" : safeKey.slice(0, slash);
    const name = slash === -1 ? safeKey : safeKey.slice(slash + 1);
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
    return !error && Boolean(data?.some((f) => f.name === name));
  }
  try {
    await fs.stat(resolveLocalPath(storagePath));
    return true;
  } catch {
    return false;
  }
}

/** Абсолютный путь файла в локальном хранилище (с защитой от выхода за корень). */
export function resolveLocalPath(storagePath: string): string {
  const filePath = path.join(LOCAL_ROOT(), sanitizeKey(storagePath));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT()))) throw new Error("Invalid path");
  return resolved;
}

export async function readLocalFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(resolveLocalPath(storagePath));
}

/** Читает байты файла из хранилища (для zip-экспорта и передачи референсов провайдеру). */
export async function readFile(storagePath: string): Promise<Buffer> {
  const safeKey = sanitizeKey(storagePath);
  if (supabaseConfigured()) {
    const supabase = await supabaseClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(safeKey);
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return readLocalFile(safeKey);
}

/**
 * Скачивает результат с CDN провайдера в своё хранилище (TZ M5 — не зависеть
 * от срока жизни их ссылок). Возвращает storage_path.
 */
export async function saveFromUrl(url: string, key: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать результат (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const data = Buffer.from(await res.arrayBuffer());
  return putFile(key, data, contentType);
}

export async function deleteFile(storagePath: string): Promise<void> {
  const safeKey = sanitizeKey(storagePath);
  if (supabaseConfigured()) {
    const supabase = await supabaseClient();
    await supabase.storage.from(BUCKET).remove([safeKey]);
  } else {
    await fs.rm(path.join(LOCAL_ROOT(), safeKey), { force: true });
  }
}
