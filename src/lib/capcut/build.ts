/**
 * Сборка черновика CapCut (draft) прямо в папке проектов CapCut на этом ПК, чтобы
 * он сразу появился в списке проектов. Все видео эпизода укладываются на одну
 * видео-дорожку встык, в порядке серии (см. exportVideos).
 *
 * Формат сверен с реальным черновиком CapCut 8.1.1 (app_source "cc", version
 * 360000): draft_content.json (материалы + дорожки), draft_meta_info.json
 * (метаданные для списка проектов), медиа лежат внутри папки черновика. Скелеты
 * (draft*Skeleton.json) и базы материала/сегмента (videoBase/segmentBase.json) —
 * очищенные срезы того черновика; сюда подставляются наши видео. Формат
 * проприетарный и версионный — на других версиях CapCut может не открыться.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "@/lib/storage";
import { probeVideo, extractFrameTo } from "@/lib/poster";
import contentSkeleton from "./draftContentSkeleton.json";
import metaSkeleton from "./draftMetaSkeleton.json";
import videoBase from "./videoBase.json";
import segmentBase from "./segmentBase.json";

const uid = () => randomUUID().toUpperCase();

/** Папка проектов CapCut на Windows (или null, если не определить). */
export function capcutDraftsDir(): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  return path.join(local, "CapCut", "User Data", "Projects", "com.lveditor.draft");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Companion-материалы одного видео-сегмента — нейтральные значения (без эффектов):
// нормальная скорость, пустой холст, дефолтный маппинг звука и т.д.
const speedMat = (id: string) => ({ curve_speed: null, id, mode: 0, speed: 1, type: "speed" });
const canvasMat = (id: string) => ({
  album_image: "", blur: 0, color: "", id, image: "", image_id: "", image_name: "",
  source_platform: 0, team_id: "", type: "canvas_color",
});
const soundMappingMat = (id: string) => ({
  audio_channel_mapping: 0, id, is_config_open: false, type: "none",
});
const placeholderMat = (id: string) => ({
  error_path: "", error_text: "", id, meta_type: "none", res_path: "", res_text: "", type: "placeholder_info",
});
const animationMat = (id: string) => ({
  animations: [], id, multi_language_current: "none", type: "sticker_animation",
});
const vocalMat = (id: string) => ({
  choice: 0, enter_from: "", final_algorithm: "", id, production_path: "", removed_sounds: [],
  time_range: null, type: "vocal_separation",
});

export interface CapCutResult {
  folder: string;
  count: number;
  dir: string;
}

export async function buildCapCutDraft(input: {
  slug: string;
  episodeNumber: number;
  videos: Array<{ storagePath: string; ext: string; n: number }>;
}): Promise<CapCutResult> {
  const draftsDir = capcutDraftsDir();
  if (!draftsDir) throw new Error("Не удалось определить папку CapCut (нет LOCALAPPDATA)");
  if (!(await pathExists(draftsDir))) {
    throw new Error("Папка проектов CapCut не найдена — установлен ли CapCut на этом ПК?");
  }
  // уникальное имя папки черновика (Title, Title_2, …)
  let folder = input.slug;
  for (let i = 2; await pathExists(path.join(draftsDir, folder)); i++) folder = `${input.slug}_${i}`;
  const draftDir = path.join(draftsDir, folder);
  await fs.mkdir(draftDir, { recursive: true });

  const epNum = String(input.episodeNumber).padStart(2, "0");
  const pad = Math.max(2, String(input.videos.length).length);

  const videosMat: unknown[] = [];
  const speeds: unknown[] = [];
  const canvases: unknown[] = [];
  const soundMaps: unknown[] = [];
  const placeholders: unknown[] = [];
  const anims: unknown[] = [];
  const vocals: unknown[] = [];
  const segments: Array<{ id: string } & Record<string, unknown>> = [];
  const draftMaterials: unknown[] = [];
  let cursor = 0; // текущая позиция на таймлайне (мкс)
  let totalSize = 0;
  let canvasW = 1080;
  let canvasH = 1920;

  for (const v of input.videos) {
    const mediaName = `${epNum}_${String(v.n).padStart(pad, "0")}${v.ext}`;
    const mediaAbs = path.join(draftDir, mediaName).replace(/\\/g, "/");
    const bytes = await readFile(v.storagePath);
    await fs.writeFile(path.join(draftDir, mediaName), bytes);
    totalSize += bytes.length;

    const probe = await probeVideo(v.storagePath);
    const durationUs = probe && probe.durationUs > 0 ? probe.durationUs : 5_000_000;
    const width = probe?.width || 1080;
    const height = probe?.height || 1920;
    if (v.n === 1) {
      canvasW = width;
      canvasH = height;
    }

    const matId = uid();
    const segId = uid();
    const speedId = uid();
    const canvasId = uid();
    const soundId = uid();
    const phId = uid();
    const animId = uid();
    const vocalId = uid();

    videosMat.push({
      ...structuredClone(videoBase),
      id: matId,
      path: mediaAbs,
      material_name: mediaName,
      duration: durationUs,
      width,
      height,
    });
    speeds.push(speedMat(speedId));
    canvases.push(canvasMat(canvasId));
    soundMaps.push(soundMappingMat(soundId));
    placeholders.push(placeholderMat(phId));
    anims.push(animationMat(animId));
    vocals.push(vocalMat(vocalId));

    const seg: { id: string } & Record<string, unknown> = {
      ...structuredClone(segmentBase),
      id: segId,
      material_id: matId,
      extra_material_refs: [speedId, phId, canvasId, soundId, animId, vocalId],
      source_timerange: { start: 0, duration: durationUs },
      target_timerange: { start: cursor, duration: durationUs },
      render_index: 0,
    };
    segments.push(seg);

    const nowSec = Math.floor(Date.now() / 1000);
    draftMaterials.push({
      ai_group_type: "", create_time: nowSec, duration: durationUs, extra_info: "", file_Path: "",
      height, id: randomUUID().toLowerCase(), import_time: nowSec, import_time_ms: Date.now() * 1000,
      item_source: 1, md5: "", metetype: "video",
      roughcut_time_range: { duration: durationUs, start: 0 },
      sub_time_range: { duration: -1, start: -1 }, type: 0, width,
    });
    cursor += durationUs;
  }
  const totalDuration = cursor;

  // draft_content.json — таймлайн
  const content = structuredClone(contentSkeleton) as unknown as {
    id: string;
    name: string;
    duration: number;
    canvas_config: unknown;
    materials: Record<string, unknown>;
    tracks: unknown[];
  };
  content.id = uid();
  content.name = folder;
  content.duration = totalDuration;
  content.canvas_config = { background: null, height: canvasH, ratio: "original", width: canvasW };
  content.materials.videos = videosMat;
  content.materials.speeds = speeds;
  content.materials.canvases = canvases;
  content.materials.sound_channel_mappings = soundMaps;
  content.materials.placeholder_infos = placeholders;
  content.materials.material_animations = anims;
  content.materials.vocal_separations = vocals;
  content.tracks = [
    { attribute: 0, flag: 0, id: uid(), is_default_name: true, name: "", segments, type: "video" },
  ];
  await fs.writeFile(path.join(draftDir, "draft_content.json"), JSON.stringify(content));

  // draft_meta_info.json — для списка проектов CapCut
  const meta = structuredClone(metaSkeleton) as unknown as Record<string, unknown>;
  const nowUs = Date.now() * 1000;
  meta.draft_id = uid();
  meta.draft_name = folder;
  meta.draft_fold_path = draftDir.replace(/\\/g, "/");
  meta.draft_root_path = draftsDir;
  meta.draft_materials = [{ type: 0, value: draftMaterials }];
  meta.draft_segment_extra_info = segments.map((s) => ({
    extra_mask_aspect_ratio_locked: false,
    extra_segmend_id: s.id,
  }));
  meta.draft_timeline_materials_size_ = totalSize;
  meta.tm_draft_create = nowUs;
  meta.tm_draft_modified = nowUs;
  meta.tm_duration = totalDuration;
  await fs.writeFile(path.join(draftDir, "draft_meta_info.json"), JSON.stringify(meta));

  // обложка (best-effort) — первый кадр первого видео
  if (input.videos[0]) {
    await extractFrameTo(input.videos[0].storagePath, path.join(draftDir, "draft_cover.jpg")).catch(() => {});
  }

  return { folder, count: input.videos.length, dir: draftDir };
}
