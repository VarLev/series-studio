import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, episodes, generations, references, shots, shotEntities, entities } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { displayGroupNumbers } from "@/lib/beats";
import { getT } from "@/lib/i18n-server";
import { activityFingerprint, availableImageModels } from "@/lib/generation";
import { getFileUrls } from "@/lib/storage";
import { thumbForResult } from "@/lib/poster";
import Link from "next/link";
import { ScreenHeader } from "@/components/ui";
import EpisodeTabs from "@/components/episode/EpisodeTabs";
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

  // Миниатюра группы = кадр лучшего результата: последний утверждённый (★),
  // иначе первый готовый. Видео показываем стоп-кадром, картинку — как есть.
  // узкие колонки (не тянем килобайтные params_json) + фильтр «готовый результат» в SQL
  const resultRows = shotRows.length
    ? await db
        .select({
          shotId: generations.shotId,
          status: generations.status,
          winner: generations.winner,
          createdAt: generations.createdAt,
          resultStoragePath: generations.resultStoragePath,
        })
        .from(generations)
        .where(
          and(
            inArray(generations.shotId, shotRows.map((s) => s.id)),
            eq(generations.status, "done"),
            isNotNull(generations.resultStoragePath),
          ),
        )
    : [];
  const bestByShot = new Map<string, (typeof resultRows)[number]>();
  for (const s of shotRows) {
    const arr = resultRows
      .filter((g) => g.shotId === s.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!arr.length) continue;
    const winners = arr.filter((g) => g.winner);
    bestByShot.set(s.id, winners.length ? winners[winners.length - 1] : arr[0]);
  }
  // миниатюра: постер-jpg видео, если есть рядом, иначе само видео (thumbForResult)
  const thumbByShot = new Map<string, { url: string; isVideo: boolean }>();
  await Promise.all(
    [...bestByShot.entries()].map(async ([sid, g]) => {
      thumbByShot.set(sid, await thumbForResult(g.resultStoragePath!));
    }),
  );

  // номер группы в серии: вставные группы (isInsert) в нумерацию не входят
  const displayNoById = displayGroupNumbers(shotRows);

  // у каких групп уже есть кадр раскадровки — бейдж в списке групп: покрытие
  // эпизода раскадровкой должно читаться одним взглядом, без открытия вкладки
  const storyboardShotIds = new Set(
    (
      await db
        .select({ sbShotId: references.sbShotId })
        .from(references)
        .where(and(eq(references.episodeId, id), eq(references.source, "storyboard-frame")))
    )
      .map((r) => r.sbShotId)
      .filter((sid): sid is string => Boolean(sid)),
  );

  const shotItems: ShotListItem[] = shotRows.map((s) => {
    // чистые визуальные описания шотов группы — промпт листа раскадровки
    // не должен содержать «Шот N (00:00–00:05):» и обрезанные хвосты
    let beats: string[] = [];
    try {
      const parsed = JSON.parse(s.beatsJson || "[]") as Array<{
        action?: string;
        camera?: string;
        framing?: string;
        draft?: boolean;
      }>;
      if (Array.isArray(parsed)) {
        // черновые шоты (Draft Shots) в лист раскадровки не идут — только основные
        beats = parsed
          .filter((b) => !b.draft)
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
      sceneStart: s.sceneStart,
      isInsert: s.isInsert,
      displayNo: displayNoById.get(s.id) ?? 0,
      entityNames: links
        .filter((l) => l.shotId === s.id)
        .map((l) => entityById.get(l.entityId)?.name ?? "")
        .filter(Boolean),
      beats,
      emotionalTone: s.emotionalTone,
      hasStoryboard: storyboardShotIds.has(s.id),
      thumbUrl: thumbByShot.get(s.id)?.url ?? null,
      thumbIsVideo: thumbByShot.get(s.id)?.isVideo ?? false,
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

  // «приложить референсы»: аватары сущностей серии + обычные референсы серии (не листы/кадры).
  // kind/name нужны для авто-строк промпта «Use reference image N as …» (роль по порядку)
  const entityAvatarRows = (
    entityIds.length
      ? await db.select().from(references).where(inArray(references.entityId, entityIds))
      : []
  ).filter((r) => r.entityId && !r.shotId);

  // подписи URL — ОДНИМ батчем (getFileUrls) на листы, кадры и «приложить»:
  // поштучный getFileUrl на каждый референс складывался в заметную паузу при
  // каждом открытии серии (у Supabase это отдельный сетевой вызов на картинку)
  const urlRows = [...seriesRefRows, ...entityAvatarRows];
  const urlList = await getFileUrls(urlRows.map((r) => r.storagePath));
  const urlByPath = new Map(urlRows.map((r, i) => [r.storagePath, urlList[i]]));
  const urlOf = (storagePath: string) => urlByPath.get(storagePath) ?? "";

  const toItem = (r: (typeof seriesRefRows)[number]) => ({
    id: r.id,
    url: urlOf(r.storagePath),
    token: r.token,
    caption: r.caption,
    sbShotId: r.sbShotId,
    panel: r.sbPanel,
  });

  const sheets: StoryboardSheetData[] = sheetRows.map((r) => ({
    ...toItem(r),
    grid: r.grid!,
    frames: frameRows
      .filter((f) => f.parentId === r.id)
      // по номеру панели, а не по подписи: у правок/апскейлов кадра подпись с
      // суффиксом, и сортировка строкой ставила их в случайные места листа
      .sort(
        (a, b) =>
          (a.sbPanel ?? 0) - (b.sbPanel ?? 0) || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(toItem),
  }));
  const orphanFrames = frameRows
    .filter((f) => !f.parentId || !sheetIds.has(f.parentId))
    .map(toItem);

  const attachRefs = [
    ...entityAvatarRows.map((r) => {
      const entity = entityById.get(r.entityId!);
      return {
        id: r.id,
        url: urlOf(r.storagePath),
        label: entity?.name ?? "сущность",
        kind: entity?.type ?? "character",
        name: entity?.name ?? "",
      };
    }),
    ...seriesRefRows
      .filter((r) => !r.grid && r.source !== "storyboard-frame")
      .map((r) => ({
        id: r.id,
        url: urlOf(r.storagePath),
        label: r.token ?? r.caption ?? "REF",
        kind: "series",
        name: r.token ?? r.caption ?? "REF",
      })),
  ];

  // активные задачи эпизода ОБОИХ видов (узкие колонки): и референсы-листы, и видео
  // шотов — иначе, пока пользователь на списке групп, статусы «генерируется» у шотов
  // замирают (провайдера никто не опрашивает). Видео-задачи имеют episode_id.
  const activeGenRows = await db
    .select({ id: generations.id, kind: generations.kind, paramsJson: generations.paramsJson })
    .from(generations)
    .where(
      and(
        eq(generations.episodeId, id),
        inArray(generations.status, ["queued", "running"]),
      ),
    );
  // полоса «рисуется» на вкладке раскадровки — только листы-референсы (storyboard)
  const pendingStoryboards = activeGenRows.filter((g) => {
    if (g.kind !== "reference") return false;
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
          // очередь убрана (нижний таб-бар теперь на всех экранах); REF и Галерея
          // открываются правым слайдером поверх экрана (intercepting @drawer)
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
          </div>
        }
      />
      <GenPoller activeCount={activeGenRows.length} initialFp={await activityFingerprint()} />
      <EpisodeTabs
        episodeId={episode.id}
        initialTitle={episode.title}
        initialLogline={episode.logline}
        initialSynopsis={episode.synopsisMd}
        shots={shotItems}
        breakdownModel={settings.llm_model}
        useCli={settings.llm_use_cli === "1"}
        storyboard={storyboard}
      />
    </main>
  );
}
