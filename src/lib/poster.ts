/**
 * Постеры видео: первый кадр mp4/webm/mov, извлечённый ffmpeg в JPEG рядом с
 * видео. Нужны, чтобы миниатюры на страницах отдавались лёгким jpg, а не
 * несколькими range-запросами mp4 через cloudflare-туннель (замер: десятки
 * видео-запросов насыщали пул соединений браузера). Генерятся best-effort при
 * приземлении результата; для уже существующих видео НЕ бэкфилятся (миниатюра
 * фолбэчится на само видео).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileExists, getFileUrl, putFile, readFile, resolveLocalPath } from "@/lib/storage";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

/** Путь постера рядом с видео: results/<shotId>/<genId>.mp4 → …/<genId>.poster.jpg */
export function posterPathFor(videoStoragePath: string): string {
  return videoStoragePath.replace(/\.[^./]+$/, ".poster.jpg");
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

/**
 * Извлечь первый кадр видео в JPEG-постер рядом с видео. Best-effort: любой сбой
 * (ffmpeg не установлен — напр. production-install без devDeps, битый файл, не
 * видео) НЕ роняет приземление результата, а возвращает null. Возвращает
 * storage_path постера при успехе.
 */
export async function generateVideoPoster(videoStoragePath: string): Promise<string | null> {
  if (!VIDEO_EXT.test(videoStoragePath)) return null;
  let ffmpegPath: string | null = null;
  try {
    ffmpegPath = (await import("ffmpeg-static")).default;
  } catch {
    return null; // пакет недоступен
  }
  if (!ffmpegPath) return null;

  const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const rnd = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempOut = path.join(os.tmpdir(), `ss-poster-${rnd}.jpg`);
  let tempInput: string | null = null;
  try {
    let inputPath: string;
    if (supabase) {
      // видео в облаке — качаем во временный файл под ffmpeg
      const bytes = await readFile(videoStoragePath);
      tempInput = path.join(os.tmpdir(), `ss-poster-${rnd}.bin`);
      await fs.writeFile(tempInput, bytes);
      inputPath = tempInput;
    } else {
      inputPath = resolveLocalPath(videoStoragePath);
    }
    await runFfmpeg(ffmpegPath, ["-y", "-i", inputPath, "-frames:v", "1", "-q:v", "3", tempOut]);
    const posterBytes = await fs.readFile(tempOut);
    const posterKey = posterPathFor(videoStoragePath);
    await putFile(posterKey, posterBytes, "image/jpeg");
    return posterKey;
  } catch {
    return null;
  } finally {
    await fs.rm(tempOut, { force: true }).catch(() => {});
    if (tempInput) await fs.rm(tempInput, { force: true }).catch(() => {});
  }
}

/**
 * Миниатюра результата генерации: для видео предпочитаем постер (лёгкий jpg,
 * thumbIsVideo:false), если он есть рядом; иначе — само видео (текущее поведение).
 * Картинки отдаём как есть.
 */
export async function thumbForResult(
  resultStoragePath: string,
): Promise<{ url: string; isVideo: boolean }> {
  if (VIDEO_EXT.test(resultStoragePath)) {
    const poster = posterPathFor(resultStoragePath);
    if (await fileExists(poster)) {
      return { url: await getFileUrl(poster), isVideo: false };
    }
    return { url: await getFileUrl(resultStoragePath), isVideo: true };
  }
  return { url: await getFileUrl(resultStoragePath), isVideo: false };
}
