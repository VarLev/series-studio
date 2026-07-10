import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { putFile } from "@/lib/storage";
import { getDb, references, generations, shots } from "@/lib/db";
import { nextRefToken, probeImageSize, recalcShotStatus } from "@/lib/generation";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

function extFor(type: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  return map[type] ?? "";
}

/**
 * Загрузка файлов:
 *  kind=reference  + entityId | shotId(+role) | episodeId  → референс (изображение)
 *  kind=result     + shotId (+promptId)                    → внешний результат (видео/картинка, M6)
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "reference");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  const allowed = kind === "result" ? [...IMAGE_TYPES, ...VIDEO_TYPES] : IMAGE_TYPES;
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: `Неподдерживаемый тип файла: ${file.type}` }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const db = await getDb();

  if (kind === "result") {
    const shotId = String(form.get("shotId") ?? "");
    if (!shotId) return NextResponse.json({ error: "shotId обязателен" }, { status: 400 });
    const storagePath = await putFile(`results/${shotId}/${id}${extFor(file.type)}`, buffer, file.type);
    await db.insert(generations).values({
      id,
      shotId,
      promptId: (form.get("promptId") as string) || null,
      provider: "manual",
      model: "kling-web",
      status: "done",
      resultStoragePath: storagePath,
      source: "kling-web",
    });
    await recalcShotStatus(shotId);
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
    return NextResponse.json({ ok: true, id, storagePath });
  }

  const entityId = (form.get("entityId") as string) || null;
  const shotId = (form.get("shotId") as string) || null;
  const episodeId = (form.get("episodeId") as string) || null;
  const role = (form.get("role") as string) || null;
  const sourceRaw = String(form.get("source") ?? "upload");
  const source = ["upload", "frame-grab"].includes(sourceRaw) ? sourceRaw : "upload";
  const storagePath = await putFile(
    `refs/${entityId ?? shotId ?? episodeId ?? "misc"}/${id}${extFor(file.type)}`,
    buffer,
    file.type,
  );
  // референс серии (без сущности и шота) получает токен REF_NN и размеры (spec §1)
  const isSeriesRef = Boolean(episodeId && !entityId && !shotId);
  const { width, height } = await probeImageSize(buffer);
  const normalizedRole = role === "start_frame" || role === "composition" ? role : null;
  if (shotId && normalizedRole === "start_frame") {
    // start-frame один на шот — прежний становится композицией (spec §3.6)
    await db
      .update(references)
      .set({ role: "composition" })
      .where(eq(references.shotId, shotId));
  }
  await db.insert(references).values({
    id,
    entityId,
    shotId,
    episodeId,
    storagePath,
    caption: String(form.get("caption") ?? ""),
    source,
    role: normalizedRole,
    token: isSeriesRef ? await nextRefToken(episodeId!) : null,
    width,
    height,
  });
  if (entityId) revalidatePath(`/bible/${entityId}`);
  if (episodeId) revalidatePath(`/episodes/${episodeId}/refs`);
  if (shotId) {
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
  }
  return NextResponse.json({ ok: true, id, storagePath });
}
