"use server";

import { requireAuth } from "@/lib/auth";
import { getEpisodeExport } from "@/lib/exportVideos";
import { latinSlug } from "@/lib/translit";
import { buildCapCutDraft } from "@/lib/capcut/build";

/**
 * Экспорт эпизода в CapCut: сервер (локальный, на этом же ПК) создаёт папку-
 * черновик прямо в проектах CapCut — проект сразу виден в CapCut, видео уложены
 * на таймлайн в порядке серии. Пишет на диск локально, поэтому это server action
 * (не скачивание). ZIP-экспорт — отдельный роут (это уже скачивание файла).
 */
export async function exportEpisodeToCapCut(
  episodeId: string,
): Promise<{ ok: true; folder: string; count: number } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const data = await getEpisodeExport(episodeId, "all");
    if (!data) return { ok: false, error: "Эпизод не найден" };
    if (!data.videos.length) return { ok: false, error: "В эпизоде нет готовых видео" };
    const slug = latinSlug(data.episode.title, `episode_${data.episode.number}`);
    const res = await buildCapCutDraft({
      slug,
      episodeNumber: data.episode.number,
      videos: data.videos.map((v) => ({ storagePath: v.storagePath, ext: v.ext, n: v.n })),
    });
    return { ok: true, folder: res.folder, count: res.count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось создать черновик CapCut" };
  }
}
