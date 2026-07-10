import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import {
  getDb,
  entities,
  episodes,
  generations,
  prompts,
  references,
  shots,
  shotEntities,
} from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { getAllSettings } from "@/lib/settings";
import { ScreenHeader, StatusPill, SectionLabel, EmptyState } from "@/components/ui";
import EntityChips from "@/components/shot/EntityChips";
import ShotRefs from "@/components/shot/ShotRefs";
import PromptBlock from "@/components/shot/PromptBlock";
import ActionBar from "@/components/shot/ActionBar";
import EditableAction from "@/components/shot/EditableAction";
import ResultsStrip from "@/components/shot/ResultsStrip";

export const dynamic = "force-dynamic";

export default async function ShotPage(ctx: {
  params: Promise<{ id: string; shotId: string }>;
}) {
  await requireAuth();
  const { id: episodeId, shotId } = await ctx.params;
  const db = await getDb();

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.episodeId !== episodeId) notFound();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));

  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const allEntities = await db
    .select()
    .from(entities)
    .where(eq(entities.archived, false))
    .orderBy(asc(entities.name));
  const linkedIds = new Set(links.map((l) => l.entityId));

  // avatar = first reference image of each entity
  const entityRefs = allEntities.length
    ? await db
        .select()
        .from(references)
        .where(inArray(references.entityId, allEntities.map((e) => e.id)))
    : [];
  const avatarByEntity = new Map<string, string>();
  for (const ref of entityRefs) {
    if (ref.entityId && !ref.shotId && !avatarByEntity.has(ref.entityId)) {
      avatarByEntity.set(ref.entityId, await getFileUrl(ref.storagePath));
    }
  }

  const chipData = await Promise.all(
    allEntities.map(async (e) => ({
      id: e.id,
      name: e.name,
      elementName: e.elementName,
      type: e.type,
      avatarUrl: avatarByEntity.get(e.id) ?? null,
      linked: linkedIds.has(e.id),
      auto: links.find((l) => l.entityId === e.id)?.auto ?? false,
    })),
  );

  const shotRefRows = await db.select().from(references).where(eq(references.shotId, shotId));
  const shotRefs = await Promise.all(
    shotRefRows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      caption: r.caption,
      role: (r.role ?? "composition") as "start_frame" | "composition",
    })),
  );

  // references available to attach (from linked entities' bible galleries)
  const bibleRefs = await Promise.all(
    entityRefs
      .filter((r) => r.entityId && linkedIds.has(r.entityId) && !r.shotId)
      .map(async (r) => ({
        id: r.id,
        url: await getFileUrl(r.storagePath),
        caption: r.caption,
        entityName: allEntities.find((e) => e.id === r.entityId)?.name ?? "",
      })),
  );

  const versionRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));
  const versions = versionRows.map((v) => ({
    id: v.id,
    version: v.version,
    text: v.text,
    negativePrompt: v.negativePrompt ?? "",
    targetModel: v.targetModel,
    feedbackNote: v.feedbackNote ?? "",
    createdAt: v.createdAt.toISOString(),
  }));

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.shotId, shotId))
    .orderBy(desc(generations.createdAt));
  const results = await Promise.all(
    genRows.map(async (g) => ({
      id: g.id,
      model: g.model,
      status: g.status,
      source: g.source,
      error: g.error ?? "",
      url: g.resultStoragePath ? await getFileUrl(g.resultStoragePath) : null,
      isVideo: Boolean(g.resultStoragePath?.match(/\.(mp4|webm|mov)$/i)),
      isWinner: shot.winnerGenerationId === g.id,
      createdAt: g.createdAt.toISOString(),
    })),
  );

  const settings = await getAllSettings();
  const targetModels = settings.target_models.split(",").map((m) => m.trim()).filter(Boolean);
  const epN = String(episode?.number ?? 0).padStart(2, "0");
  const grpN = String(shot.orderIndex).padStart(2, "0");
  const tokens = chipData.filter((c) => c.linked).map((c) => c.elementName);
  const current = versions[0] ?? null;

  // копи-пак: референсы шота + референсы задействованных сущностей
  const copyPackRefs = [
    ...shotRefs.map((r) => ({ url: r.url, name: r.caption || r.role })),
    ...bibleRefs.map((r) => ({ url: r.url, name: `${r.entityName}${r.caption ? " · " + r.caption : ""}` })),
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref={`/episodes/${episodeId}`}
        eyebrow={`Серия ${epN} · Группа ${grpN}`}
        title={shot.title || "Группа шотов"}
      />

      <div className="flex flex-1 flex-col gap-4 p-4 pb-32">
        <div className="flex items-center gap-3.5">
          <div className="chrome-text font-display text-[46px] font-bold leading-[0.9] tracking-[0.03em]">
            {grpN}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div>
              <StatusPill status={shot.status} />
            </div>
            <div className="font-mono text-[10.5px] tracking-[0.04em] text-t300">
              {shot.durationSec} сек · {versions.length ? `промпт v${current!.version}` : "промпта нет"} ·{" "}
              {results.length} видео
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Фрагмент сюжета</SectionLabel>
          <EditableAction shotId={shotId} initial={shot.actionMd} cameraHint={shot.cameraHint} />
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel hint="определил Claude · правится вручную">Сущности</SectionLabel>
          <EntityChips shotId={shotId} entities={chipData} />
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel hint="роль: start-frame · композиция">Референсы шота</SectionLabel>
          <ShotRefs shotId={shotId} refs={shotRefs} bibleRefs={bibleRefs} />
        </div>

        <PromptBlock
          shotId={shotId}
          episodeId={episodeId}
          versions={versions}
          tokens={tokens}
          targetModels={targetModels}
        />

        <div className="flex flex-col gap-1.5">
          <SectionLabel hint={`${results.length}`}>Видео группы</SectionLabel>
          {results.length ? (
            <ResultsStrip shotId={shotId} results={results} />
          ) : (
            <EmptyState>
              Видео пока нет. Соберите промпт, затем «Копи-пак» — сгенерируйте на kling.ai и
              загрузите результат сюда. Генерация внутри приложения — Этап 2.
            </EmptyState>
          )}
        </div>
      </div>

      <ActionBar
        episodeId={episodeId}
        shotId={shotId}
        promptText={current?.text ?? ""}
        promptVersion={current?.version ?? 0}
        promptId={current?.id ?? ""}
        copyPackRefs={copyPackRefs}
        hasPrompt={Boolean(current)}
      />
    </main>
  );
}
