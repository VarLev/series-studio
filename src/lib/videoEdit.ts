/**
 * Правка готового видео-дубля: исходный ролик (целиком или выделенный на
 * таймлайне фрагмент «от/до») уходит ВИДЕО-референсом (role video_references)
 * в Seedance 2.0 Mini через Higgsfield MCP + инструкция, что изменить.
 * Результат — новый дубль того же шота, приземляется существующим поллером
 * (job_status → results/{shotId}/{genId}.mp4).
 * Выбор модели (живые тесты 2026-07-20):
 *  - Kling MCP видео в image_1..7 не переваривает (2×18 кр, тихий FAIL) —
 *    видео-референсы Omni остались веб-фичей kling.ai;
 *  - gemini_omni падал молча и ловил ложный nsfw на реалистичном человеке;
 *  - seedance_2_0_mini воспроизвёл дубль с точечной правкой идеально (5 кр/5с,
 *    идентичность/композиция/движение сохранены), геометрия выхода = исходник.
 * Апскейла нет: Seedance принимает 480p-референсы как есть. Фрагмент режется
 * ffmpeg-ом во временный файл (точный рез → перекодирование CRF 16) и после
 * выгрузки удаляется; окно расширяется до минимума модели в 4 секунды.
 * Двухфазная схема как в submitJobs: queued-строка мгновенно, сеть — в фоне.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { getDb, generations } from "@/lib/db";
import { recalcShotStatus } from "@/lib/generation";
import { HiggsfieldMcpProvider } from "@/lib/providers/higgsfieldMcp";
import { fileExists, putFile, readFile, resolveLocalPath } from "@/lib/storage";
import { ffmpegBinary, probeVideo } from "@/lib/poster";
import { logModelCall } from "@/lib/modelLog";

/** Проверенная модель video-to-video правки (тест 2026-07-20, 5 кр/5с 480p). */
export const VIDEO_EDIT_MODEL = "seedance_2_0_mini";

// как runFfmpeg из poster.ts, но с хвостом stderr в ошибке: рез фрагмента —
// обязательный шаг правки, голое «ffmpeg exit 1» в карточке задачи бесполезно
function runFfmpegVerbose(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`)),
    );
  });
}

/**
 * Прогон ffmpeg над файлом из storage: вход резолвится локально (или скачивается
 * из облака во временный файл), выход возвращается байтами; временные файлы
 * чистятся здесь же.
 */
async function ffmpegOverStorage(
  videoStoragePath: string,
  buildArgs: (inputPath: string, outputPath: string) => string[],
): Promise<Buffer> {
  const bin = await ffmpegBinary();
  if (!bin) throw new Error("FFmpeg недоступен (пакет ffmpeg-static)");
  const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const rnd = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempOut = path.join(os.tmpdir(), `ss-vid-${rnd}.mp4`);
  let tempInput: string | null = null;
  try {
    let inputPath: string;
    if (supabase) {
      const bytes = await readFile(videoStoragePath);
      tempInput = path.join(os.tmpdir(), `ss-vid-${rnd}.bin`);
      await fs.writeFile(tempInput, bytes);
      inputPath = tempInput;
    } else {
      inputPath = resolveLocalPath(videoStoragePath);
    }
    await runFfmpegVerbose(bin, buildArgs(inputPath, tempOut));
    return await fs.readFile(tempOut);
  } finally {
    await fs.rm(tempOut, { force: true }).catch(() => {});
    if (tempInput) await fs.rm(tempInput, { force: true }).catch(() => {});
  }
}

// общий хвост кодирования производных файлов (near-lossless)
const ENC_VIDEO = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p"];
const ENC_TAIL = ["-movflags", "+faststart"];

/** scale-фильтр до 720 по КОРОТКОЙ стороне (портрет 9:16: наивный -2:720 уменьшил бы высоту). */
function scale720Filter(probe: { width: number; height: number }): string {
  return probe.width < probe.height ? "scale=720:-2:flags=lanczos" : "scale=-2:720:flags=lanczos";
}

/**
 * Точный вырез фрагмента [fromSec, toSec) — байтами, без сохранения в storage
 * (референс для правки одноразовый). Перекодирование CRF 16: стрим-копия
 * резала бы только по ключевым кадрам.
 */
async function trimFragmentBytes(
  videoStoragePath: string,
  fromSec: number,
  toSec: number,
): Promise<Buffer> {
  return ffmpegOverStorage(videoStoragePath, (input, output) => [
    "-y",
    "-ss",
    fromSec.toFixed(3),
    "-i",
    input,
    "-t",
    (toSec - fromSec).toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...ENC_VIDEO,
    // звук перекодируем: aac-копия на непопадании в границу фрейма рвёт синхрон
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    ...ENC_TAIL,
    output,
  ]);
}

/**
 * Файл выбранного диапазона дубля для СКАЧИВАНИЯ: точный рез (без расширения
 * до минимума модели — это ограничение правки, не скачивания), опционально
 * 720p-апскейл. Кешируется рядом с исходником:
 * results/{shotId}/{genId}.clip-<от>-<до>[.720p].mp4 (границы в сотых секунды).
 */
export async function ensureClipFile(
  videoStoragePath: string,
  fromSec: number,
  toSec: number | null, // null = до конца ролика
  upscale: boolean,
): Promise<string> {
  const from = Math.max(0, Math.round(fromSec * 100) / 100);
  const to = toSec != null ? Math.round(toSec * 100) / 100 : null;
  if (to != null && to <= from) throw new Error("Фрагмент пуст: конец должен быть позже начала");
  const tag = `clip-${Math.round(from * 100)}-${to != null ? Math.round(to * 100) : "end"}${upscale ? ".720p" : ""}`;
  const derivedKey = videoStoragePath.replace(/\.[^./]+$/, `.${tag}.mp4`);
  if (await fileExists(derivedKey)) return derivedKey;
  let vf: string | null = null;
  if (upscale) {
    const probe = await probeVideo(videoStoragePath);
    if (!probe || !probe.width || !probe.height) {
      throw new Error("FFmpeg недоступен (пакет ffmpeg-static) — фрагмент не подготовить");
    }
    if (Math.min(probe.width, probe.height) < 720) vf = scale720Filter(probe);
  }
  const bytes = await ffmpegOverStorage(videoStoragePath, (input, output) => [
    "-y",
    "-ss",
    from.toFixed(3),
    "-i",
    input,
    ...(to != null ? ["-t", (to - from).toFixed(3)] : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...(vf ? ["-vf", vf] : []),
    ...ENC_VIDEO,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    ...ENC_TAIL,
    output,
  ]);
  await putFile(derivedKey, bytes, "video/mp4");
  return derivedKey;
}

/**
 * 720p-версия дубля для скачивания: lanczos-апскейл по короткой стороне
 * (портрет 9:16: наивный -2:720 УМЕНЬШИЛ бы высоту), CRF 16, кеш рядом с
 * исходником (results/{shotId}/{genId}.720p.mp4 — повторное скачивание
 * отдаёт готовый файл). Исходник ≥720p возвращается как есть.
 */
export async function ensure720pFile(videoStoragePath: string): Promise<string> {
  const derivedKey = videoStoragePath.replace(/\.[^./]+$/, ".720p.mp4");
  if (await fileExists(derivedKey)) return derivedKey;
  const probe = await probeVideo(videoStoragePath);
  if (!probe || !probe.width || !probe.height) {
    throw new Error("FFmpeg недоступен (пакет ffmpeg-static) — 720p-версию не подготовить");
  }
  if (Math.min(probe.width, probe.height) >= 720) return videoStoragePath;
  const bytes = await ffmpegOverStorage(videoStoragePath, (input, output) => [
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    scale720Filter(probe),
    ...ENC_VIDEO,
    "-c:a",
    "copy",
    ...ENC_TAIL,
    output,
  ]);
  await putFile(derivedKey, bytes, "video/mp4");
  return derivedKey;
}

/** Минимальная длительность референса/выхода seedance mini, сек. */
const MIN_EDIT_SEC = 4;

export async function submitVideoEditJob(input: {
  sourceGenerationId: string;
  instruction: string;
  /** выделенный на таймлайне фрагмент; отсутствие обеих границ = весь ролик */
  fromSec?: number | null;
  toSec?: number | null;
}): Promise<{ genId: string }> {
  const db = await getDb();
  const [src] = await db
    .select()
    .from(generations)
    .where(eq(generations.id, input.sourceGenerationId));
  if (!src) throw new Error("Исходный дубль не найден");
  if (src.kind !== "video" || !src.shotId) {
    throw new Error("Правка доступна только для видео-дублей шота");
  }
  if (src.status !== "done" || !src.resultStoragePath) {
    throw new Error("Исходный дубль ещё не готов — править можно только завершённое видео");
  }
  const sourcePath = src.resultStoragePath;
  const shotId = src.shotId;
  const wantsFragment = input.fromSec != null || input.toSec != null;

  // фрагмент режется ffmpeg-ом — без него падаем ДО постановки задачи
  if (wantsFragment && !(await ffmpegBinary())) {
    throw new Error(
      "FFmpeg не найден (devDependency ffmpeg-static) — вырезать фрагмент нельзя. Выполните npm install или правьте весь ролик.",
    );
  }

  // длительность/формат наследуем от исходника: paramsJson, фолбэк — проба ffmpeg
  let srcParams: Record<string, unknown> = {};
  try {
    srcParams = JSON.parse(src.paramsJson ?? "{}") as Record<string, unknown>;
  } catch {}
  let srcDurationSec = Math.round(Number(srcParams.duration)) || 0;
  let aspectRatio = typeof srcParams.aspect_ratio === "string" ? srcParams.aspect_ratio : "";
  if (!srcDurationSec || !aspectRatio || wantsFragment) {
    const probe = await probeVideo(sourcePath).catch(() => null);
    // для фрагмента фактическая длина файла важнее числа из paramsJson
    if (probe?.durationUs) srcDurationSec = Math.round(probe.durationUs / 1_000_000);
    if (!srcDurationSec) srcDurationSec = 5;
    if (!aspectRatio && probe && probe.width && probe.height) {
      aspectRatio = probe.width < probe.height ? "9:16" : probe.width > probe.height ? "16:9" : "1:1";
    }
  }
  aspectRatio = aspectRatio || "9:16";

  // окно фрагмента: зажать в границы ролика и расширить до минимума модели (4 с)
  let fragment: { from: number; to: number } | null = null;
  if (wantsFragment) {
    let from = Math.max(0, Number(input.fromSec ?? 0) || 0);
    let to = Math.min(srcDurationSec, Number(input.toSec ?? srcDurationSec) || srcDurationSec);
    if (to <= from) throw new Error("Фрагмент пуст: конец должен быть позже начала");
    if (to - from < MIN_EDIT_SEC) {
      to = Math.min(srcDurationSec, from + MIN_EDIT_SEC);
      if (to - from < MIN_EDIT_SEC) from = Math.max(0, to - MIN_EDIT_SEC);
    }
    fragment = { from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100 };
  }
  const durationSec = Math.min(
    15,
    Math.max(MIN_EDIT_SEC, Math.round(fragment ? fragment.to - fragment.from : srcDurationSec)),
  );
  // правка в качестве исходника; mini умеет только 480p/720p
  const srcQuality = typeof srcParams.quality === "string" ? srcParams.quality : "";
  const resolution = srcQuality === "720p" ? "720p" : "480p";

  const baseParams = {
    quality: resolution,
    duration: durationSec,
    aspect_ratio: aspectRatio,
    resolution,
    source_tag: "video-edit",
    edit_source_generation_id: src.id,
    edit_instruction: input.instruction,
    edit_fragment: fragment, // {from,to} в секундах исходника; null = весь ролик
    estimate: null as number | null, // уточняется бесплатным get_cost в фазе 2
    estimate_exact: false,
  };

  // ---- Фаза 1 (быстро, без сети): queued-плейсхолдер ----
  const genId = crypto.randomUUID();
  await db.insert(generations).values({
    id: genId,
    shotId,
    episodeId: src.episodeId,
    kind: "video",
    promptId: null, // правка — не версия промпта
    provider: "higgsfield-mcp",
    model: VIDEO_EDIT_MODEL,
    status: "queued",
    source: "api",
    // маркеры шотов наследуем только для правки целиком: у фрагмента своя
    // шкала времени, абсолютные маркеры исходника на ней врали бы
    beatsJson: fragment ? null : src.beatsJson,
    paramsJson: JSON.stringify({ ...baseParams, _pending: { at: Date.now() } }),
  });
  await recalcShotStatus(shotId);

  // ---- Фаза 2 (фон): выгрузка видео в Higgsfield + submit, обновление той же строки ----
  void (async () => {
    const started = Date.now();
    // рамка без перечислений («same characters» и т.п. противоречили бы
    // инструкциям на удаление/замену): применить только правку, остальное —
    // как в референсе
    const editPrompt =
      `Recreate the reference video, applying only this change: ${input.instruction}. ` +
      `Everything not affected by this change must stay exactly as in the reference video.`;
    const logRequest: Record<string, unknown> = {
      prompt: editPrompt,
      instruction: input.instruction,
      editSourceGenerationId: src.id,
      sourceVideo: sourcePath,
      fragment,
      durationSec,
      aspectRatio,
    };
    const logRefs = [{ id: src.id, caption: "исходный дубль", role: "video_reference" }];
    try {
      const { isConnected } = await import("@/lib/higgsfieldMcp");
      if (!(await isConnected())) {
        throw new Error("Higgsfield не подключён — подключите его в «Настройках» и повторите");
      }
      const provider = new HiggsfieldMcpProvider();
      const bytes = fragment
        ? await trimFragmentBytes(sourcePath, fragment.from, fragment.to)
        : await readFile(sourcePath);
      const media = await provider.uploadMedia(bytes, "video/mp4");
      const exactCost = await provider
        .preflightCost({
          model: VIDEO_EDIT_MODEL,
          prompt: input.instruction,
          duration: durationSec,
          aspect_ratio: aspectRatio,
          resolution,
        })
        .catch(() => null);
      const sub = await provider
        .submitVideoEdit({
          model: VIDEO_EDIT_MODEL,
          prompt: editPrompt,
          videoMediaId: media.id,
          durationSec,
          aspectRatio,
          resolution,
        })
        .catch(async (e: unknown) => {
          await logModelCall({
            channel: "video",
            kind: "video-edit",
            provider: "higgsfield-mcp",
            model: VIDEO_EDIT_MODEL,
            status: "error",
            request: logRequest,
            response: { error: e instanceof Error ? e.message : String(e) },
            refs: logRefs,
            durationMs: Date.now() - started,
            episodeId: src.episodeId,
            shotId,
          });
          throw e;
        });
      await logModelCall({
        channel: "video",
        kind: "video-edit",
        provider: "higgsfield-mcp",
        model: VIDEO_EDIT_MODEL,
        status: "ok",
        request: logRequest,
        response: { jobId: sub.jobId },
        refs: logRefs,
        durationMs: Date.now() - started,
        episodeId: src.episodeId,
        shotId,
      });
      // _pending исчезает вместе с новым paramsJson → строка перестаёт быть плейсхолдером
      await db
        .update(generations)
        .set({
          providerJobId: sub.jobId,
          paramsJson: JSON.stringify({
            ...baseParams,
            estimate: exactCost,
            estimate_exact: exactCost != null,
            edit_video_media_id: media.id,
          }),
        })
        .where(eq(generations.id, genId));
    } catch (e) {
      await db
        .update(generations)
        .set({
          status: "failed",
          error: e instanceof Error ? e.message : "Не удалось отправить правку",
        })
        .where(eq(generations.id, genId));
      await recalcShotStatus(shotId);
    }
  })().catch(() => {});

  return { genId };
}
