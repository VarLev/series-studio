import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { buildBeatMarkers } from "@/lib/beatMarkers";
import { putFile } from "@/lib/storage";
import { normalizeUploadImage } from "@/lib/image";
import { getDb, references, generations, shots } from "@/lib/db";
import { nextRefToken, probeImageSize, recalcShotStatus } from "@/lib/generation";
import { reconcileShotPromptRefs } from "@/lib/refDirectives";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

// Потолок размера: тело целиком лежит в памяти (formData + arrayBuffer), поэтому
// без лимита один большой файл кладёт процесс. Референс — картинка с телефона,
// результат — ролик на 5–15 секунд; запас взят с большим зазором к обоим.
const MAX_BYTES: Record<string, number> = { reference: 20 * 1024 * 1024, result: 200 * 1024 * 1024 };

/**
 * Тип файла по СИГНАТУРЕ, а не по заголовку от клиента: form-data несёт тот
 * content-type, который прислали, и «image/png» с чем угодно внутри проходил
 * насквозь до хранилища. Возвращаем null, если сигнатура не опознана.
 */
function sniffType(buf: Buffer): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand.startsWith("qt")) return "video/quicktime";
    return "video/mp4"; // isom/mp42/avc1/M4V… — всё это mp4-семейство
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm"; // EBML (webm/mkv)
  return null;
}

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
  // размер проверяем ДО чтения тела в память
  const limit = MAX_BYTES[kind === "result" ? "result" : "reference"];
  if (file.size > limit) {
    return NextResponse.json(
      { error: `Файл больше ${Math.round(limit / 1024 / 1024)} МБ` },
      { status: 413 },
    );
  }
  const rawBuffer = Buffer.from(await file.arrayBuffer());
  // тип берём по сигнатуре: заголовку от клиента верить нельзя
  const sniffed = sniffType(rawBuffer);
  if (!sniffed || !allowed.includes(sniffed)) {
    return NextResponse.json(
      { error: `Содержимое файла не похоже на ${kind === "result" ? "видео/картинку" : "картинку"}` },
      { status: 400 },
    );
  }
  // крупные изображения ужимаем без видимой потери качества (EXIF-поворот,
  // длинная сторона ≤ 2048, пережатие) — видео и GIF проходят как есть
  const norm = IMAGE_TYPES.includes(sniffed)
    ? await normalizeUploadImage(rawBuffer, sniffed)
    : { data: rawBuffer, contentType: sniffed, ext: extFor(sniffed) };
  const buffer = norm.data;
  const id = crypto.randomUUID();
  const db = await getDb();

  if (kind === "result") {
    const shotId = String(form.get("shotId") ?? "");
    if (!shotId) return NextResponse.json({ error: "shotId обязателен" }, { status: 400 });
    // группа нужна до вставки: за видео закрепляется снапшот её шотов — маркеры
    // смены шота в плеере (правка группы задним числом их уже не сдвинет)
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    const storagePath = await putFile(`results/${shotId}/${id}${norm.ext}`, buffer, norm.contentType);
    await db.insert(generations).values({
      id,
      shotId,
      promptId: (form.get("promptId") as string) || null,
      provider: "manual",
      model: "kling-web",
      status: "done",
      resultStoragePath: storagePath,
      source: "kling-web",
      beatsJson: JSON.stringify(buildBeatMarkers(shot?.beatsJson)),
    });
    await recalcShotStatus(shotId);
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
    `refs/${entityId ?? shotId ?? episodeId ?? "misc"}/${id}${norm.ext}`,
    buffer,
    norm.contentType,
  );
  // референс серии (без сущности и шота) получает токен REF_NN и размеры (spec §1)
  const isSeriesRef = Boolean(episodeId && !entityId && !shotId);
  const { width, height } = await probeImageSize(buffer);
  const normalizedRole =
    role === "start_frame" || role === "composition" || role === "layout" ? role : null;

  // Загрузка со страницы шота (есть и episodeId, и shotId, без сущности): референс
  // ложится И в список референсов серии (источник, shotId=null), И прикрепляется
  // копией к шоту (общий файл) — как attachReferenceToShot. Иначе он оставался бы
  // только на шоте и не появлялся в списке референсов эпизода.
  if (episodeId && shotId && !entityId) {
    const caption = String(form.get("caption") ?? "");
    await db.insert(references).values({
      id, // источник в списке серии
      episodeId,
      shotId: null,
      entityId: null,
      storagePath,
      caption,
      source,
      role: null,
      token: await nextRefToken(episodeId),
      width,
      height,
    });
    const shotCopyId = crypto.randomUUID();
    await db.insert(references).values({
      id: shotCopyId, // копия, прикреплённая к шоту
      shotId,
      episodeId: null,
      entityId: null,
      storagePath,
      caption,
      source,
      role: normalizedRole ?? "composition",
      width,
      height,
    });
    // анализ картинки vision-моделью в фоне (не блокируем загрузку); результат
    // кэшируется за файлом и уходит в Enhance/Rework. Enhance/Rework догоняют его
    // сами (ensureShotRefsAnalyzed), даже если фоновый вызов не успел.
    void import("@/lib/refs").then(({ ensureReferenceAnalysis }) =>
      ensureReferenceAnalysis(shotCopyId).catch(() => {}),
    );
    // авто-синхронизация начальных строк-директив референса в промптах шота (без модели)
    await reconcileShotPromptRefs(shotId);
    revalidatePath(`/episodes/${episodeId}/refs`);
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
    return NextResponse.json({ ok: true, id, storagePath });
  }

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
  // референсы шота и серии анализируем vision-моделью в фоне (у сущностей библии
  // свой разбор — кнопка «Анализ», её не трогаем)
  if (!entityId) {
    void import("@/lib/refs").then(({ ensureReferenceAnalysis }) =>
      ensureReferenceAnalysis(id).catch(() => {}),
    );
  }
  // добавили референс к шоту → перестраиваем начальные строки его промптов (без модели)
  if (shotId) await reconcileShotPromptRefs(shotId);
  if (entityId) revalidatePath(`/bible/${entityId}`);
  if (episodeId) revalidatePath(`/episodes/${episodeId}/refs`);
  if (shotId) {
    const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
    if (shot) revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
  }
  return NextResponse.json({ ok: true, id, storagePath });
}
