import { NextRequest, NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { isAuthenticated } from "@/lib/auth";
import { readFile } from "@/lib/storage";
import { getEpisodeExport } from "@/lib/exportVideos";
import { latinSlug } from "@/lib/translit";

export const maxDuration = 120;

/**
 * ZIP-экспорт видео эпизода. ?scope=all — ВСЕ готовые видео (кнопка «Экспорт» на
 * карточке эпизода); без параметра — только победители (старая «скачать всё» в
 * галерее). Файлы: Название_эпизода_латиницей_НомерСерии_НомерВидео.ext, номер
 * видео — сквозной по эпизоду в порядке серии (ранние сцены раньше).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "winners";
  const data = await getEpisodeExport(id, scope);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!data.videos.length) {
    return NextResponse.json({ error: "нет видео для экспорта" }, { status: 400 });
  }

  const slug = latinSlug(data.episode.title, `episode_${data.episode.number}`);
  const epNum = String(data.episode.number).padStart(2, "0");
  const pad = Math.max(2, String(data.videos.length).length);

  const archive = new ZipArchive({ zlib: { level: 0 } }); // видео уже сжаты
  const sink = new PassThrough();
  archive.pipe(sink);
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    archive.on("error", reject);
  });

  for (const v of data.videos) {
    const data8 = await readFile(v.storagePath);
    archive.append(data8, { name: `${slug}_${epNum}_${String(v.n).padStart(pad, "0")}${v.ext}` });
  }
  await archive.finalize();
  await finished;

  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}_${epNum}.zip"`,
    },
  });
}
