import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { resolveLocalPath } from "@/lib/storage";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/** Тело ответа: поток с диска вместо чтения файла в память. */
function fileStream(filePath: string, opts?: { start: number; end: number }) {
  return Readable.toWeb(createReadStream(filePath, opts)) as ReadableStream;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { path: segments } = await ctx.params;
  const key = segments.join("/");

  let filePath: string;
  let size: number;
  try {
    filePath = resolveLocalPath(key);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable",
    // Range нужен видео-плеерам: без него мобильный браузер качает весь mp4
    // и не умеет перематывать
    "Accept-Ranges": "bytes",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m?.[1] ? Number(m[1]) : NaN;
    let end = m?.[2] ? Number(m[2]) : NaN;
    if (m && Number.isNaN(start) && !Number.isNaN(end)) {
      // суффикс: последние N байт
      start = Math.max(0, size - end);
      end = size - 1;
    } else if (m && !Number.isNaN(start)) {
      end = Number.isNaN(end) ? size - 1 : Math.min(end, size - 1);
    }
    if (!m || Number.isNaN(start) || start >= size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    return new NextResponse(fileStream(filePath, { start, end }), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(fileStream(filePath), {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
