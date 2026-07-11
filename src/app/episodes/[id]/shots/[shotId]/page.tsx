import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
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
import { getCatalog, availableImageModels } from "@/lib/generation";
import { getTechniquesByIds } from "@/lib/director";
import type { GroupShot } from "@/lib/llm/contracts";
import { getT } from "@/lib/i18n-server";
import { ScreenHeader, StatusPill, SectionLabel, EmptyState, SHOT_STATUS } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteAllGenerations } from "@/lib/actions/deletes";
import EntityChips from "@/components/shot/EntityChips";
import StyleChips from "@/components/shot/StyleChips";
import ShotRefs from "@/components/shot/ShotRefs";
import PromptBlock from "@/components/shot/PromptBlock";
import ActionBar from "@/components/shot/ActionBar";
import EditableAction from "@/components/shot/EditableAction";
import ResultsStrip from "@/components/shot/ResultsStrip";
import ShotHotkeys from "@/components/shot/ShotHotkeys";
import GenPoller from "@/components/GenPoller";
import QueuePill from "@/components/QueuePill";
import FilmStrip from "@/components/FilmStrip";

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

  // шоты внутри группы (раскадровка v2); у старых групп beats_json пуст
  let beats: GroupShot[] = [];
  try {
    const parsed = JSON.parse(shot.beatsJson || "[]");
    if (Array.isArray(parsed)) beats = parsed as GroupShot[];
  } catch {}

  // все шоты серии — кинолента + master-список (spec §2.3/§4)
  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, episodeId))
    .orderBy(asc(shots.orderIndex));
  const shotIds = allShots.map((s) => s.id);
  const shotRefsAll = shotIds.length
    ? await db.select().from(references).where(inArray(references.shotId, shotIds))
    : [];
  const thumbByShot = new Map<string, string>();
  for (const ref of shotRefsAll.sort((a) => (a.role === "start_frame" ? -1 : 0))) {
    if (ref.shotId && !thumbByShot.has(ref.shotId)) {
      thumbByShot.set(ref.shotId, await getFileUrl(ref.storagePath));
    }
  }
  const stripShots = allShots.map((s) => ({
    id: s.id,
    orderIndex: s.orderIndex,
    status: s.status,
    thumbUrl: thumbByShot.get(s.id) ?? null,
  }));
  const shotIdx = allShots.findIndex((s) => s.id === shotId);
  const prevShot = allShots[shotIdx - 1] ?? null;
  const nextShot = allShots[shotIdx + 1] ?? null;

  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const allEntities = await db
    .select()
    .from(entities)
    .where(eq(entities.archived, false))
    .orderBy(asc(entities.name));
  const linkedIds = new Set(links.map((l) => l.entityId));

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

  const chipData = allEntities.map((e) => ({
    id: e.id,
    name: e.name,
    elementName: e.elementName,
    type: e.type,
    avatarUrl: avatarByEntity.get(e.id) ?? null,
    linked: linkedIds.has(e.id),
    auto: links.find((l) => l.entityId === e.id)?.auto ?? false,
  }));
  const styleChips = chipData
    .filter((c) => c.type === "style")
    .map((c) => ({ id: c.id, name: c.name, linked: c.linked }));
  const entityChips = chipData.filter((c) => c.type !== "style");

  // референсы шота (с ролями)
  const shotRefRows = shotRefsAll.filter((r) => r.shotId === shotId);
  const shotRefs = await Promise.all(
    shotRefRows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      caption: r.caption,
      role: (r.role ?? "composition") as "start_frame" | "composition",
    })),
  );

  // референсы серии (spec §1: один список на серию)
  const seriesRefRows = await db
    .select()
    .from(references)
    .where(
      and(eq(references.episodeId, episodeId), isNull(references.shotId), isNull(references.entityId)),
    )
    .orderBy(asc(references.createdAt));
  const seriesRefs = await Promise.all(
    seriesRefRows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      label: r.token ?? r.caption ?? "REF",
      sub: r.caption,
    })),
  );

  const bibleRefs = await Promise.all(
    entityRefs
      .filter((r) => r.entityId && linkedIds.has(r.entityId) && !r.shotId)
      .map(async (r) => ({
        id: r.id,
        url: await getFileUrl(r.storagePath),
        label: allEntities.find((e) => e.id === r.entityId)?.name ?? "",
        sub: r.caption,
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
  const promptVersionById = new Map(versionRows.map((v) => [v.id, v.version]));

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
      promptVersion: g.promptId ? (promptVersionById.get(g.promptId) ?? null) : null,
      credits: g.creditsSpent,
    })),
  );
  const activeCount = results.filter((r) => r.status === "queued" || r.status === "running").length;

  const settings = await getAllSettings();
  const catalog = await getCatalog("video");
  const defaultModelIds = settings.target_models.split(",").map((m) => m.trim()).filter(Boolean);

  const epN = String(episode?.number ?? 0).padStart(2, "0");
  const grpN = String(shot.orderIndex).padStart(2, "0");
  const tokens = [
    ...chipData.filter((c) => c.linked).map((c) => c.elementName),
    ...seriesRefRows.map((r) => r.token).filter((t): t is string => Boolean(t)),
  ];
  const current = versions[0] ?? null;
  const currentParams = versionRows[0]
    ? (JSON.parse(versionRows[0].paramsJson || "{}") as {
        aspect_ratio?: string;
        duration?: number;
        techniques?: string[];
      })
    : {};
  // режиссёрские приёмы, использованные фабрикой в текущей версии (бейджи 🎥)
  const usedTechniques = (await getTechniquesByIds(currentParams.techniques ?? [])).map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    camera: t.camera,
    lens: t.lens,
    lighting: t.lighting,
    tags: t.tags,
    prompt: t.prompt,
    negative: t.negative,
  }));

  // start-frame кандидаты: рефы шота (start_frame первым) + референсы серии
  const startFrames = [
    ...shotRefs
      .slice()
      .sort((a, b) => (a.role === "start_frame" ? -1 : 0) - (b.role === "start_frame" ? -1 : 0))
      .map((r) => ({ id: r.id, url: r.url, label: r.caption || r.role })),
    ...seriesRefs.map((r) => ({ id: r.id, url: r.url, label: r.label })),
  ];
  const defaultStartFrame = shotRefs.find((r) => r.role === "start_frame") ?? null;

  const copyPackRefs = [
    ...shotRefs.map((r) => ({ url: r.url, name: r.caption || r.role })),
    ...bibleRefs.map((r) => ({ url: r.url, name: r.label })),
  ];

  const shotHref = (s: { id: string }) => `/episodes/${episodeId}/shots/${s.id}`;

  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl lg:max-w-none">
      <ScreenHeader
        backHref={`/episodes/${episodeId}`}
        eyebrow={`${t("Серия", "Episode")} ${epN} · ${t("Группа", "Group")} ${grpN}`}
        title={shot.title || t("Группа шотов", "Shot group")}
        right={<QueuePill />}
      />
      <GenPoller activeCount={activeCount} />
      <ShotHotkeys
        prevHref={prevShot ? shotHref(prevShot) : null}
        nextHref={nextShot ? shotHref(nextShot) : null}
        editorHref={`${shotHref(shot)}/editor`}
        backHref={`/episodes/${episodeId}`}
      />

      {/* кинолента — только на мобиле; на десктопе шоты в master-колонке (не дублируем) */}
      <div className="lg:hidden">
        <FilmStrip episodeId={episodeId} shots={stripShots} currentShotId={shotId} />
      </div>

      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[280px_1fr]">
        {/* master-колонка (spec §4, десктоп) */}
        <aside className="hidden overflow-y-auto border-r border-[var(--border-subtle)] p-3 lg:block">
          <div className="section-label mb-2">{t("Шоты серии", "Episode shots")}</div>
          <div className="flex flex-col gap-1.5">
            {allShots.map((s) => {
              const st = SHOT_STATUS[s.status] ?? SHOT_STATUS.draft;
              const active = s.id === shotId;
              return (
                <Link
                  key={s.id}
                  href={shotHref(s)}
                  className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                  style={{
                    borderColor: active ? "var(--border-strong)" : "var(--border-subtle)",
                    background: active ? "var(--ink-600)" : "none",
                  }}
                >
                  <span className="chrome-text font-display text-[13px] font-bold">
                    {String(s.orderIndex).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-t200">
                    {s.title || s.actionMd.slice(0, 30)}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "generating" ? "pulse-amber" : ""}`}
                    style={{ background: st.color }}
                  />
                </Link>
              );
            })}
          </div>
        </aside>

        {/* detail (на десктопе справа резервируем место под панель действий) */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 pb-32 lg:pb-6 lg:pr-[212px]">
          <div className="flex items-center gap-3.5">
            <div className="chrome-text font-display text-[46px] font-bold leading-[0.9] tracking-[0.03em]">
              {grpN}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div>
                <StatusPill status={shot.status} />
              </div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-t300">
                {shot.timecode ? `${shot.timecode} · ` : ""}
                {shot.durationSec} {t("сек", "sec")}
                {beats.length ? ` · ${t("шотов", "shots")} ${beats.length}` : ""} ·{" "}
                {versions.length
                  ? `${t("промпт", "prompt")} v${current!.version}`
                  : t("промпта нет", "no prompt")}{" "}
                · {t("видео", "videos")} {results.filter((r) => r.status === "done").length}
              </div>
            </div>
          </div>

          {beats.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <SectionLabel hint={t("из раскадровки сюжета", "from the story breakdown")}>
                {t("Шоты группы", "Group shots")}
              </SectionLabel>
              <div className="flex flex-col gap-1.5">
                {beats.map((b) => (
                  <div
                    key={b.order}
                    className="rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-2.5"
                  >
                    <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
                      {t("Шот", "Shot")} {b.order}
                      {b.time ? ` · ${b.time}` : ""}
                    </div>
                    {(b.framing || b.camera) && (
                      <div className="mb-1 font-mono text-[10px] leading-relaxed text-t400">
                        {b.framing && <>🎥 {b.framing}</>}
                        {b.framing && b.camera && " · "}
                        {b.camera}
                      </div>
                    )}
                    {b.action && (
                      <div className="text-[12px] leading-relaxed text-t200">{b.action}</div>
                    )}
                    {b.dialogue && (
                      <div className="mt-1 text-[12px] leading-relaxed text-violet-200">
                        «{b.dialogue}»
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <SectionLabel
              hint={beats.length ? t("правится, уходит в фабрику", "editable, feeds the factory") : undefined}
            >
              {t("Фрагмент сюжета", "Story fragment")}
            </SectionLabel>
            <EditableAction shotId={shotId} initial={shot.actionMd} cameraHint={shot.cameraHint} />
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel
              hint={t("определил Claude · правится вручную", "detected by Claude · editable")}
            >
              {t("Сущности", "Entities")}
            </SectionLabel>
            <EntityChips shotId={shotId} entities={entityChips} />
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel hint={t("уходят в промпт-фабрику", "feed the prompt factory")}>
              {t("Наборы стилей", "Style sets")}
            </SectionLabel>
            <StyleChips shotId={shotId} styles={styleChips} />
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel hint={t("тап по бейджу — роль", "tap the badge to set role")}>
              {t("Референсы шота", "Shot references")}
            </SectionLabel>
            <ShotRefs
              shotId={shotId}
              episodeId={episodeId}
              refs={shotRefs}
              seriesRefs={seriesRefs}
              bibleRefs={bibleRefs}
              promptText={current?.text ?? shot.actionMd}
              imageModels={await availableImageModels()}
            />
          </div>

          <PromptBlock
            shotId={shotId}
            episodeId={episodeId}
            versions={versions}
            tokens={tokens}
            targetModels={catalog.map((m) => m.id)}
            usedTechniques={usedTechniques}
          />

          <div className="flex flex-col gap-1.5">
            <SectionLabel
              hint={`${results.length}`}
              right={
                results.length > 0 ? (
                  <ConfirmButton
                    action={deleteAllGenerations.bind(null, shotId)}
                    label={t("удалить все", "delete all")}
                    confirmLabel={t("Удалить все результаты?", "Delete all results?")}
                    doneToast={t("Результаты удалены", "Results deleted")}
                    className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-t400 hover:text-danger disabled:opacity-50"
                  />
                ) : undefined
              }
            >
              {t("Видео группы", "Group videos")}
            </SectionLabel>
            {results.length ? (
              <ResultsStrip episodeId={episodeId} shotId={shotId} results={results} />
            ) : (
              <EmptyState>
                {t(
                  "Видео пока нет. Соберите промпт и нажмите «Генерировать» — задача уйдёт в Higgsfield. Либо «Копи-пак» для ручной генерации на kling.ai.",
                  "No videos yet. Build a prompt and press Generate — the job goes to Higgsfield. Or use Copy pack for manual generation on kling.ai.",
                )}
              </EmptyState>
            )}
          </div>
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
        models={catalog}
        defaultModelIds={defaultModelIds}
        startFrames={startFrames}
        groupDurationSec={shot.durationSec}
        aspectRatio={currentParams.aspect_ratio ?? "16:9"}
        defaultStartFrameId={defaultStartFrame?.id ?? null}
      />
    </main>
  );
}
