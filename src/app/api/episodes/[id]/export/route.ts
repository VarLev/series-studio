import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { isAuthenticated } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { readFile } from "@/lib/storage";

export const maxDuration = 120;

/** M5 — «скачать всё»: zip ВСЕХ видео-победителей эпизода (у шота их может быть несколько). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) return NextResponse.json({ error: "not found" }, { status: 404 });

  const shotRows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, id))
    .orderBy(asc(shots.orderIndex));
  const shotById = new Map(shotRows.map((s) => [s.id, s]));
  const winners = shotRows.length
    ? await db
        .select()
        .from(generations)
        .where(
          and(
            eq(generations.winner, true),
            eq(generations.status, "done"),
            inArray(generations.shotId, shotRows.map((s) => s.id)),
          ),
        )
    : [];
  winners.sort((a, b) => {
    const ao = shotById.get(a.shotId!)?.orderIndex ?? 0;
    const bo = shotById.get(b.shotId!)?.orderIndex ?? 0;
    return ao - bo || a.createdAt.getTime() - b.createdAt.getTime();
  });
  if (!winners.length) {
    return NextResponse.json({ error: "нет видео-победителей" }, { status: 400 });
  }

  const archive = new ZipArchive({ zlib: { level: 0 } }); // видео уже сжаты
  const sink = new PassThrough();
  archive.pipe(sink);
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    archive.on("error", reject);
  });

  // нумерация внутри шота: shot-01a, shot-01b… если победителей несколько
  const perShotCount = new Map<string, number>();
  for (const gen of winners) {
    if (!gen.resultStoragePath || !gen.shotId) continue;
    const shot = shotById.get(gen.shotId);
    if (!shot) continue;
    const n = (perShotCount.get(gen.shotId) ?? 0) + 1;
    perShotCount.set(gen.shotId, n);
    const suffix = n > 1 || winners.filter((w) => w.shotId === gen.shotId).length > 1
      ? String.fromCharCode(96 + n) // a, b, c…
      : "";
    const ext = gen.resultStoragePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4";
    const data = await readFile(gen.resultStoragePath);
    archive.append(data, {
      name: `shot-${String(shot.orderIndex).padStart(2, "0")}${suffix}${ext}`,
    });
  }
  await archive.finalize();
  await finished;

  const epN = String(episode.number).padStart(2, "0");
  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="episode-${epN}.zip"`,
    },
  });
}
