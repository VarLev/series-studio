import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { isAuthenticated } from "@/lib/auth";
import { getDb, episodes, generations, shots } from "@/lib/db";
import { readFile } from "@/lib/storage";

export const maxDuration = 120;

/** M5 — «скачать всё»: zip утверждённых шотов эпизода (победители по порядку). */
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
  const approved = shotRows.filter((s) => s.status === "approved" && s.winnerGenerationId);
  if (!approved.length) {
    return NextResponse.json({ error: "нет утверждённых шотов" }, { status: 400 });
  }
  const gens = await db
    .select()
    .from(generations)
    .where(inArray(generations.id, approved.map((s) => s.winnerGenerationId!)));
  const genById = new Map(gens.map((g) => [g.id, g]));

  const archive = new ZipArchive({ zlib: { level: 0 } }); // видео уже сжаты
  const sink = new PassThrough();
  archive.pipe(sink);
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    archive.on("error", reject);
  });

  for (const shot of approved) {
    const gen = genById.get(shot.winnerGenerationId!);
    if (!gen?.resultStoragePath) continue;
    const ext = gen.resultStoragePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4";
    const data = await readFile(gen.resultStoragePath);
    archive.append(data, {
      name: `shot-${String(shot.orderIndex).padStart(2, "0")}${ext}`,
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
