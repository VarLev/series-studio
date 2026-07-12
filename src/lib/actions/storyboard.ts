"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, entities, references, shots, shotEntities } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getCatalog, nextRefToken, submitReferenceJob } from "@/lib/generation";
import { putFile, readFile } from "@/lib/storage";
import { imageModelMeta } from "@/lib/imageModels";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Лист раскадровки (spec-дополнение заказчика): вертикальное изображение 9:16
 * с сеткой 2×2 или 3×3 вертикальных кадров. Область — вся серия или один шот.
 * Результат приземляется как референс серии (REF_NN) с пометкой grid.
 */
export async function generateStoryboard(input: {
  episodeId: string;
  shotId?: string | null;
  frames: 4 | 9;
  resolution: "1k" | "2k" | "4k";
  prompt: string;
  refIds: string[];
  model?: string;
}): Promise<Result> {
  await requireAuth();
  try {
    if (!input.prompt.trim()) return { ok: false, error: "Промпт раскадровки пуст" };
    if (input.frames !== 4 && input.frames !== 9) {
      return { ok: false, error: "В сетке может быть 4 или 9 кадров" };
    }
    const catalog = await getCatalog("image");
    const model =
      (input.model && catalog.find((m) => m.id === input.model)) ??
      catalog.find((m) => m.id.includes("nano_banana")) ??
      catalog[0];
    if (!model) return { ok: false, error: "В каталоге нет image-моделей" };
    const meta = imageModelMeta(model.id);
    const value = meta?.cost[input.resolution] ?? Object.values(meta?.cost ?? {})[0] ?? 6;
    const usd = meta?.unit === "usd" ? value : null;
    const credits = meta?.unit === "usd" ? null : value;

    let caption = `Раскадровка ${input.frames === 9 ? "3×3" : "2×2"} · вся серия`;
    let prompt = input.prompt.trim();
    if (input.shotId) {
      const db = await getDb();
      const [shot] = await db.select().from(shots).where(eq(shots.id, input.shotId));
      if (!shot || shot.episodeId !== input.episodeId) {
        return { ok: false, error: "Шот не найден в этой серии" };
      }
      caption = `Раскадровка ${input.frames === 9 ? "3×3" : "2×2"} · группа ${String(shot.orderIndex).padStart(2, "0")}`;
      // якорь одежды группы: кадры листа должны рисоваться в закреплённой одежде
      const links = await db
        .select()
        .from(shotEntities)
        .where(eq(shotEntities.shotId, input.shotId));
      const chars = links.length
        ? await db.select().from(entities).where(inArray(entities.id, links.map((l) => l.entityId)))
        : [];
      const outfitBy = new Map(links.map((l) => [l.entityId, l.outfit]));
      const outfits = chars
        .filter((e) => e.type === "character")
        .map((e) => ({ name: e.elementName, outfit: (outfitBy.get(e.id) || e.wardrobe).trim() }))
        .filter((x) => x.outfit);
      if (outfits.length) {
        prompt +=
          "\n\nWardrobe lock — keep each character's clothing identical in every panel:\n" +
          outfits.map((x) => `- ${x.name}: ${x.outfit}`).join("\n");
      }
    }

    await submitReferenceJob({
      episodeId: input.episodeId,
      model: model.id,
      prompt,
      aspectRatio: "9:16",
      resolution: input.resolution,
      sourceRefIds: input.refIds.length ? input.refIds : undefined,
      sourceTag: "storyboard",
      credits,
      usd,
      sbGrid: input.frames,
      sbShotId: input.shotId ?? null,
      caption,
    });
    revalidatePath(`/episodes/${input.episodeId}`);
    revalidatePath(`/episodes/${input.episodeId}/refs`);
    revalidatePath("/queue");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/**
 * Разрезать лист на отдельные кадры: сетка grid (4 → 2×2, 9 → 3×3) режется sharp'ом,
 * каждый кадр становится самостоятельным референсом серии (REF_NN, source=storyboard-frame).
 * Исходный лист не тронут; кадры — отдельные файлы, живут независимо от листа.
 */
export async function sliceStoryboard(
  refId: string,
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const db = await getDb();
    const [sheet] = await db.select().from(references).where(eq(references.id, refId));
    if (!sheet?.episodeId) return { ok: false, error: "Лист не найден" };
    if (sheet.grid !== 4 && sheet.grid !== 9) {
      return { ok: false, error: "Это не лист раскадровки — резать нечего" };
    }

    const data = await readFile(sheet.storagePath);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return { ok: false, error: "Не удалось прочитать изображение" };

    const n = sheet.grid === 9 ? 3 : 2; // кадров на сторону
    const cellW = Math.floor(meta.width / n);
    const cellH = Math.floor(meta.height / n);
    if (cellW < 16 || cellH < 16) return { ok: false, error: "Изображение слишком маленькое для разрезки" };

    let created = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const cell = await sharp(data)
          .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
          .jpeg({ quality: 92 })
          .toBuffer();
        const id = crypto.randomUUID();
        const storagePath = await putFile(
          `refs/series/${sheet.episodeId}/${id}.jpg`,
          cell,
          "image/jpeg",
        );
        const token = await nextRefToken(sheet.episodeId);
        await db.insert(references).values({
          id,
          episodeId: sheet.episodeId,
          storagePath,
          caption: `${sheet.token ?? "лист"} · кадр ${row * n + col + 1}`,
          source: "storyboard-frame",
          token,
          width: cellW,
          height: cellH,
          parentId: sheet.id,
          sbShotId: sheet.sbShotId,
        });
        created++;
      }
    }
    revalidatePath(`/episodes/${sheet.episodeId}`);
    revalidatePath(`/episodes/${sheet.episodeId}/refs`);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось разрезать лист" };
  }
}
