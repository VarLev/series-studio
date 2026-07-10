import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, entities, prompts, shots, shotEntities, episodes } from "@/lib/db";
import { ScreenHeader } from "@/components/ui";
import PromptEditor from "@/components/editor/PromptEditor";

export const dynamic = "force-dynamic";

export default async function EditorPage(ctx: {
  params: Promise<{ id: string; shotId: string }>;
}) {
  await requireAuth();
  const { id: episodeId, shotId } = await ctx.params;
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.episodeId !== episodeId) notFound();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));

  const versionRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));

  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const linkedIds = new Set(links.map((l) => l.entityId));
  const allEntities = await db
    .select()
    .from(entities)
    .where(eq(entities.archived, false))
    .orderBy(asc(entities.name));

  const grpN = String(shot.orderIndex).padStart(2, "0");

  return (
    <main className="mx-auto flex h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${episodeId}/shots/${shotId}`}
        eyebrow="Редактор промпта"
        title={`Группа ${grpN} · ${shot.title || episode?.title || ""}`}
      />
      <PromptEditor
        shotId={shotId}
        episodeId={episodeId}
        versions={versionRows.map((v) => ({
          id: v.id,
          version: v.version,
          text: v.text,
          negativePrompt: v.negativePrompt ?? "",
          targetModel: v.targetModel,
          feedbackNote: v.feedbackNote ?? "",
          createdAt: v.createdAt.toISOString(),
        }))}
        insertEntities={allEntities
          .filter((e) => linkedIds.has(e.id))
          .map((e) => ({ name: e.name, elementName: e.elementName }))}
      />
    </main>
  );
}
