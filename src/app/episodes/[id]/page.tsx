import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, references, shots, shotEntities, entities } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { availableImageModels } from "@/lib/generation";
import { getFileUrl } from "@/lib/storage";
import Link from "next/link";
import { ScreenHeader } from "@/components/ui";
import EpisodeTabs from "@/components/episode/EpisodeTabs";
import QueuePill from "@/components/QueuePill";
import GenPoller from "@/components/GenPoller";
import type { ShotListItem } from "@/components/episode/ShotsList";
import type { StoryboardData, StoryboardSheetData } from "@/components/episode/StoryboardTab";

export const dynamic = "force-dynamic";

export default async function EpisodePage(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const db = await getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, id));
  if (!episode) notFound();
  const settings = await getAllSettings();

  const shotRows = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, id))
    .orderBy(asc(shots.orderIndex));

  const links = shotRows.length
    ? await db
        .select()
        .from(shotEntities)
        .where(inArray(shotEntities.shotId, shotRows.map((s) => s.id)))
    : [];
  const entityIds = [...new Set(links.map((l) => l.entityId))];
  const entityRows = entityIds.length
    ? await db.select().from(entities).where(inArray(entities.id, entityIds))
    : [];
  const entityById = new Map(entityRows.map((e) => [e.id, e]));

  const shotItems: ShotListItem[] = shotRows.map((s) => {
    // чистые визуальные описания шотов группы — промпт листа раскадровки
    // не должен содержать «Шот N (00:00–00:05):» и обрезанные хвосты
    let beats: string[] = [];
    try {
      const parsed = JSON.parse(s.beatsJson || "[]") as Array<{
        action?: string;
        camera?: string;
        framing?: string;
      }>;
      if (Array.isArray(parsed)) {
        beats = parsed
          .map((b) => (b.action || b.camera || b.framing || "").trim())
          .filter(Boolean);
      }
    } catch {}
    return {
      id: s.id,
      orderIndex: s.orderIndex,
      title: s.title,
      action: s.actionMd,
      durationSec: s.durationSec,
      timecode: s.timecode,
      status: s.status,
      entityNames: links
        .filter((l) => l.shotId === s.id)
        .map((l) => entityById.get(l.entityId)?.name ?? "")
        .filter(Boolean),
      beats,
    };
  });

  // ---------- данные вкладки «Раскадровка» ----------
  // референсы серии этого эпизода: листы (grid), кадры (parent_id), прочие — для «приложить»
  const seriesRefRows = await db
    .select()
    .from(references)
    .where(
      and(eq(references.episodeId, id), isNull(references.shotId), isNull(references.entityId)),
    )
    .orderBy(desc(references.createdAt));

  const sheetRows = seriesRefRows.filter((r) => r.grid === 4 || r.grid === 9);
  const frameRows = seriesRefRows.filter((r) => r.source === "storyboard-frame");
  const sheetIds = new Set(sheetRows.map((r) => r.id));

  const toItem = async (r: (typeof seriesRefRows)[number]) => ({
    id: r.id,
    url: await getFileUrl(r.storagePath),
    token: r.token,
    caption: r.caption,
  });

  const sheets: StoryboardSheetData[] = await Promise.all(
    sheetRows.map(async (r) => ({
      ...(await toItem(r)),
      grid: r.grid!,
      sbShotId: r.sbShotId,
      frames: await Promise.all(
        frameRows
          .filter((f) => f.parentId === r.id)
          .sort((a, b) => a.caption.localeCompare(b.caption, "ru", { numeric: true }))
          .map(toItem),
      ),
    })),
  );
  const orphanFrames = await Promise.all(
    frameRows.filter((f) => !f.parentId || !sheetIds.has(f.parentId)).map(toItem),
  );

  // «приложить референсы»: аватары сущностей серии + обычные референсы серии (не листы/кадры).
  // kind/name нужны для авто-строк промпта «Use reference image N as …» (роль по порядку)
  const entityAvatarRefs = entityIds.length
    ? await db.select().from(references).where(inArray(references.entityId, entityIds))
    : [];
  const attachRefs = [
    ...(await Promise.all(
      entityAvatarRefs
        .filter((r) => r.entityId && !r.shotId)
        .map(async (r) => {
          const entity = entityById.get(r.entityId!);
          return {
            id: r.id,
            url: await getFileUrl(r.storagePath),
            label: entity?.name ?? "сущность",
            kind: entity?.type ?? "character",
            name: entity?.name ?? "",
          };
        }),
    )),
    ...(await Promise.all(
      seriesRefRows
        .filter((r) => !r.grid && r.source !== "storyboard-frame")
        .map(async (r) => ({
          id: r.id,
          url: await getFileUrl(r.storagePath),
          label: r.token ?? r.caption ?? "REF",
          kind: "series",
          name: r.token ?? r.caption ?? "REF",
        })),
    )),
  ];

  // активные задачи-листы (для полосы «рисуется» и автообновления страницы)
  const activeGenRows = await db
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.episodeId, id),
        eq(generations.kind, "reference"),
        inArray(generations.status, ["queued", "running"]),
      ),
    );
  const pendingStoryboards = activeGenRows.filter((g) => {
    try {
      return (JSON.parse(g.paramsJson || "{}") as { source_tag?: string }).source_tag === "storyboard";
    } catch {
      return false;
    }
  }).length;

  const storyboard: StoryboardData = {
    sheets,
    orphanFrames,
    attachRefs,
    pendingCount: pendingStoryboards,
    template: settings.tpl_storyboard,
    imageModels: await availableImageModels(),
  };

  const epNumber = String(episode.number).padStart(2, "0");
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={`${t("Серия", "Episode")} ${epNumber}`}
        title={episode.title || t("Без названия", "Untitled")}
        right={
          <div className="flex items-center gap-1.5">
            <Link
              href={`/episodes/${episode.id}/refs`}
              title={t("Референсы серии", "Episode references")}
              className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-default)] bg-ink-600 px-3 py-1.5 font-mono text-[11px] font-semibold text-violet-200 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              REF
            </Link>
            <Link
              href={`/episodes/${episode.id}/gallery`}
              title={t("Галерея утверждённых шотов", "Approved shots gallery")}
              className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-default)] bg-ink-600 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-t100 hover:border-[var(--border-strong)] hover:bg-ink-500"
            >
              <span className="text-[13px] leading-none">🎞</span>
              <span className="hidden md:inline">{t("Галерея", "Gallery")}</span>
            </Link>
            <QueuePill />
          </div>
        }
      />
      <GenPoller activeCount={activeGenRows.length} />
      <EpisodeTabs
        episodeId={episode.id}
        initialTitle={episode.title}
        initialLogline={episode.logline}
        initialSynopsis={episode.synopsisMd}
        shots={shotItems}
        breakdownModel={settings.llm_model}
        storyboard={storyboard}
      />
    </main>
  );
}
