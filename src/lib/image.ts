/**
 * Нормализация загружаемых изображений (sharp): чиним EXIF-ориентацию,
 * ужимаем слишком крупные фото до разумного размера без видимой потери качества
 * и держим файл под лимитом vision-моделей. Используется маршрутом загрузки и
 * анализом референса в промпт-фабрике.
 */

// самая длинная сторона после сжатия — с запасом хватает и как референс,
// и как вход vision-модели; телефонные фото 3000–4000px ужимаются заметно
const MAX_SIDE = 2048;
// выше этого размера файл пережимаем, даже если стороны в норме (лимит vision ≈ 5 МБ)
const MAX_BYTES = 3_500_000;
const JPEG_QUALITY = 88;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface NormalizedImage {
  data: Buffer;
  contentType: string;
  ext: string;
}

/**
 * Приводит изображение к «удобному» размеру без видимой потери качества:
 * поворачивает по EXIF, ужимает самую длинную сторону до MAX_SIDE и пережимает,
 * если файл крупнее MAX_BYTES. GIF (анимация) и уже компактные фото — без
 * изменений. sharp недоступен → отдаём как есть.
 */
export async function normalizeUploadImage(
  input: Buffer,
  contentType: string,
): Promise<NormalizedImage> {
  const fallbackExt = EXT_BY_TYPE[contentType] ?? "";
  // анимированный GIF пережимать нельзя (потеряем кадры) — пропускаем
  if (contentType === "image/gif") {
    return { data: input, contentType, ext: ".gif" };
  }
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const oversizedDims = Math.max(w, h) > MAX_SIDE;
    const oversizedBytes = input.length > MAX_BYTES;
    // ориентация из EXIF (>1) — фото «лежит на боку», тоже требует перезаписи
    const needsRotate = Boolean(meta.orientation && meta.orientation > 1);
    if (!oversizedDims && !oversizedBytes && !needsRotate) {
      return { data: input, contentType, ext: fallbackExt };
    }
    let pipeline = sharp(input).rotate(); // rotate() без аргумента = по EXIF
    if (oversizedDims) {
      pipeline = pipeline.resize(MAX_SIDE, MAX_SIDE, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    // с альфа-каналом → WebP (сохраняет прозрачность и хорошо жмёт);
    // непрозрачные фото → JPEG (заметно легче при том же качестве)
    if (meta.hasAlpha) {
      const data = await pipeline.webp({ quality: 90 }).toBuffer();
      return { data, contentType: "image/webp", ext: ".webp" };
    }
    const data = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return { data, contentType: "image/jpeg", ext: ".jpg" };
  } catch {
    // sharp не завёлся — не блокируем загрузку, отдаём оригинал
    return { data: input, contentType, ext: fallbackExt };
  }
}

/**
 * Байты изображения из хранилища, приведённые к виду, который точно примет
 * vision-модель (под лимитом по размеру, корректная ориентация).
 */
export async function toVisionImageData(
  input: Buffer,
  storagePath: string,
): Promise<{ base64: string; mediaType: string }> {
  const ext = storagePath.slice(storagePath.lastIndexOf(".")).toLowerCase();
  const type = TYPE_BY_EXT[ext] ?? "image/png";
  const norm = await normalizeUploadImage(input, type);
  return { base64: norm.data.toString("base64"), mediaType: norm.contentType };
}
