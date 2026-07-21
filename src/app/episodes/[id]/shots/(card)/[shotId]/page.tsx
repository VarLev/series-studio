import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import {
  getDb,
  entities,
  generations,
  prompts,
  references,
  shots,
  shotEntities,
} from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { getAllSettings } from "@/lib/settings";
import { activityFingerprint, getCatalog, availableImageModels } from "@/lib/generation";
import { getTechniquesByIds, listEnabledTechniques } from "@/lib/director";
import type { GroupShot } from "@/lib/llm/contracts";
import { stripAt } from "@/lib/entityName";
import { promptFamily } from "@/lib/llm/models";
import { getT } from "@/lib/i18n-server";
import { StatusPill, SectionLabel, EmptyState } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteAllGenerations } from "@/lib/actions/deletes";
import { ensureGroupOrigin } from "@/lib/groupOrigin";
import EntityChips from "@/components/shot/EntityChips";
import AnchorsSection from "@/components/shot/AnchorsSection";
import StateSection from "@/components/shot/StateSection";
import ShotRefs from "@/components/shot/ShotRefs";
import PromptBlock from "@/components/shot/PromptBlock";
import PromptDrawer from "@/components/shot/PromptDrawer";
import PromptTrackProvider from "@/components/shot/PromptTrackContext";
import ActionBar from "@/components/shot/ActionBar";
import EditableAction from "@/components/shot/EditableAction";
import EnhanceButton from "@/components/shot/EnhanceButton";
import RevertButton from "@/components/shot/RevertButton";
import UploadButton from "@/components/UploadButton";
import GroupShotsEditor from "@/components/shot/GroupShotsEditor";
import SceneToggle from "@/components/shot/SceneToggle";
import ResultsStrip from "@/components/shot/ResultsStrip";
import GenPoller from "@/components/GenPoller";
import {
  carriedStateAtStart,
  chainLocation,
  chainTimeWeather,
  displayGroupNumbers,
  parseStateList,
} from "@/lib/beats";
import { getEpisodeShotRows } from "@/lib/shotChrome";
import { listShotAnchors, listEpisodeAnchors } from "@/lib/anchors";

export const dynamic = "force-dynamic";

export default async function ShotPage(ctx: {
  params: Promise<{ id: string; shotId: string }>;
}) {
  await requireAuth();
  const { id: episodeId, shotId } = await ctx.params;
  const db = await getDb();

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot || shot.episodeId !== episodeId) notFound();

  // зафиксировать точку отката для Revert. Для групп, созданных до этой фичи, —
  // их текущее состояние (исходник «как при раскадровке» им взять неоткуда).
  // Идемпотентно: пишет один раз, дальше только SELECT.
  await ensureGroupOrigin(shotId);

  // шоты внутри группы (раскадровка v2); у старых групп beats_json пуст
  let beats: GroupShot[] = [];
  try {
    const parsed = JSON.parse(shot.beatsJson || "[]");
    if (Array.isArray(parsed)) beats = parsed as GroupShot[];
  } catch {}
  // основные шоты (Main): длительность/промпт/счётчики; черновики — запаски
  const mainBeats = beats.filter((b) => !b.draft);

  // Шоты серии — узкий select: цепочки локации/времени, номер группы и сосед
  // слева для тумблера сцены. Кинолента, master-колонка и их миниатюры считаются
  // в shots/(card)/layout.tsx — общее для серии, при смене группы не меняется.
  const rows = await getEpisodeShotRows(episodeId);
  // номер группы в серии: вставные группы (isInsert) в нумерацию не входят
  const displayNoById = displayGroupNumbers(rows);
  const shotIdx = rows.findIndex((s) => s.id === shotId);
  const prevShot = rows[shotIdx - 1] ?? null;

  // сквозное состояние: входящее вычисляется свёрткой дифов по связке сцены,
  // собственные дифы группы (начинается/заканчивается здесь) — из её строки
  const incomingState = shot.isInsert ? [] : carriedStateAtStart(rows, shotId);
  const stateBegin = parseStateList(shot.stateBeginJson);
  const stateEnd = parseStateList(shot.stateEndJson);

  // якоря: прикреплённые к группе + пул эпизода для переиспользования (не прикреплённые)
  const attachedAnchors = await listShotAnchors(shotId);
  const attachedAnchorIds = new Set(attachedAnchors.map((a) => a.id));
  const availableAnchors = (await listEpisodeAnchors(episodeId)).filter(
    (a) => !attachedAnchorIds.has(a.id),
  );

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
    // якорь одежды: сценарный наряд группы, базовый гардероб из библии и источник
    outfit: links.find((l) => l.entityId === e.id)?.outfit ?? "",
    wardrobe: e.wardrobe,
    outfitSource: links.find((l) => l.entityId === e.id)?.outfitSource ?? "",
  }));
  // стили в чипы сущностей не попадают («Наборы стилей» убраны как неиспользуемые)
  const entityChips = chipData.filter((c) => c.type !== "style");
  // персонажи из разбивки, которых нет в библии — красные чипы-заготовки.
  // Имя, успевшее появиться в библии другим путём, заготовкой больше не считаем.
  const bibleNames = new Set(
    allEntities.flatMap((e) => [stripAt(e.name), stripAt(e.elementName)]),
  );
  let unlinkedChars: string[] = [];
  try {
    const raw = JSON.parse(shot.unlinkedCharsJson || "[]");
    if (Array.isArray(raw)) {
      unlinkedChars = (raw as string[]).filter(
        (n) => typeof n === "string" && n.trim() && !bibleNames.has(stripAt(n)),
      );
    }
  } catch {}

  // референсы шота (с ролями); порядок createdAt = порядок якорей @Comp1..N
  // (тот же порядок использует generation.ts при прикреплении картинок к задаче)
  const shotRefRows = await db
    .select()
    .from(references)
    .where(eq(references.shotId, shotId))
    .orderBy(asc(references.createdAt));
  let compNo = 0;
  const anchorByRefId = new Map(
    shotRefRows.map((r) => [r.id, r.role === "start_frame" ? "@Start" : `@Comp${++compNo}`]),
  );
  const shotRefs = await Promise.all(
    shotRefRows.map(async (r) => ({
      id: r.id,
      url: await getFileUrl(r.storagePath),
      caption: r.caption,
      role: (r.role ?? "composition") as "start_frame" | "composition" | "layout",
      anchor: anchorByRefId.get(r.id) ?? "",
      // анализ референса (JSON {description,camera}) — для слайдера деталей и промптов
      analysis: r.analysis ?? "",
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
    seriesRefRows
      // кадр раскадровки ЭТОЙ группы — вперёд: раньше он лежал где-то среди
      // десятков референсов серии по дате, и «свой» кадр приходилось искать
      // скроллингом вслепую
      .slice()
      .sort(
        (a, b) =>
          Number(b.sbShotId === shotId) - Number(a.sbShotId === shotId) ||
          (a.sbPanel ?? 0) - (b.sbPanel ?? 0),
      )
      .map(async (r) => ({
        id: r.id,
        url: await getFileUrl(r.storagePath),
        label: r.token ?? r.caption ?? "REF",
        sub: r.caption,
        /** кадр раскадровки этой группы — бейдж и приоритет в пикерах */
        sb: r.sbShotId === shotId && r.source === "storyboard-frame",
        /** лист-сетка: как стартовый кадр 3×3-сетка бессмысленна */
        isSheet: r.grid === 4 || r.grid === 9,
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
  const promptVersionById = new Map(versionRows.map((v) => [v.id, v.version]));
  // промпт-треки: текущая (последняя) версия каждого семейства (по ПОЛНОМУ списку)
  const currentByFamily = {
    seedance: versionRows.find((v) => promptFamily(v.targetModel) === "seedance") ?? null,
    kling: versionRows.find((v) => promptFamily(v.targetModel) === "kling") ?? null,
  };
  // На клиент уезжают только последние ~10 версий + гарантированно текущие каждого
  // трека — полные тексты ВСЕХ версий были бы лишним пейлоадом через туннель.
  // currentByFamily/promptVersionById считаются выше по ПОЛНОМУ versionRows, поэтому
  // не ломаются; остальные версии подгружает listPromptVersions по «показать ещё».
  const RECENT_VERSIONS = 10;
  const keepIds = new Set(versionRows.slice(0, RECENT_VERSIONS).map((v) => v.id));
  if (currentByFamily.seedance) keepIds.add(currentByFamily.seedance.id);
  if (currentByFamily.kling) keepIds.add(currentByFamily.kling.id);
  const versions = versionRows
    .filter((v) => keepIds.has(v.id))
    .map((v) => ({
      id: v.id,
      version: v.version,
      text: v.text,
      negativePrompt: v.negativePrompt ?? "",
      targetModel: v.targetModel,
      feedbackNote: v.feedbackNote ?? "",
      createdAt: v.createdAt.toISOString(),
    }));
  const versionCountByFamily = {
    seedance: versionRows.filter((v) => promptFamily(v.targetModel) === "seedance").length,
    kling: versionRows.filter((v) => promptFamily(v.targetModel) === "kling").length,
  };

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.shotId, shotId))
    .orderBy(desc(generations.createdAt));
  const results = await Promise.all(
    genRows.map(async (g) => {
      // здоровье поллинга + число прикреплённых референсов персонажей из paramsJson
      let pollError: string | null = null;
      let characterRefs = 0;
      try {
        const bundle = JSON.parse(g.paramsJson || "{}") as {
          _poll?: { error?: string };
          character_refs?: number;
        };
        pollError = bundle._poll?.error ?? null;
        characterRefs = bundle.character_refs ?? 0;
      } catch {}
      return {
        id: g.id,
        model: g.model,
        status: g.status,
        source: g.source,
        error: g.error ?? "",
        url: g.resultStoragePath ? await getFileUrl(g.resultStoragePath) : null,
        isVideo: Boolean(g.resultStoragePath?.match(/\.(mp4|webm|mov)$/i)),
        isWinner: g.winner,
        createdAt: g.createdAt.toISOString(),
        promptVersion: g.promptId ? (promptVersionById.get(g.promptId) ?? null) : null,
        credits: g.creditsSpent,
        jobId: g.providerJobId,
        pollError,
        characterRefs,
        provider: g.provider,
      };
    }),
  );
  const activeCount = results.filter((r) => r.status === "queued" || r.status === "running").length;

  const settings = await getAllSettings();
  const catalog = await getCatalog("video");
  const defaultModelIds = settings.target_models.split(",").map((m) => m.trim()).filter(Boolean);
  // модель для авто-отправки промпта в Seedance (чекбокс в блоке «Промпт»): берём
  // Seedance-модель из дефолтного набора генерации, иначе первую Seedance каталога
  const seedanceModelId =
    defaultModelIds.find((id) => /seedance/i.test(id) && catalog.some((m) => m.id === id)) ??
    catalog.find((m) => /seedance/i.test(m.id))?.id ??
    "seedance_2_0";

  const grpN = shot.isInsert ? "✦" : String(displayNoById.get(shotId) ?? 0).padStart(2, "0");
  const hasStartFrame = shotRefs.some((r) => r.role === "start_frame");
  const tokens = [
    ...chipData.filter((c) => c.linked).map((c) => c.elementName),
    ...seriesRefRows.map((r) => r.token).filter((t): t is string => Boolean(t)),
    // якоря референсов шота: @Comp1..N (композиция) и @Start/@Image1 (стартовый кадр)
    ...shotRefs.filter((r) => r.role !== "start_frame").map((r) => r.anchor),
    ...(hasStartFrame ? ["@Start", "@Image1"] : []),
  ];
  // миниатюры токенов: тап по токену в тексте промпта раскрывает картинку
  const tokenImages: Record<string, string> = {};
  for (const c of chipData) {
    if (c.linked && c.avatarUrl) tokenImages[c.elementName] = c.avatarUrl;
  }
  seriesRefRows.forEach((r, i) => {
    if (r.token && seriesRefs[i]) tokenImages[r.token] = seriesRefs[i].url;
  });
  for (const r of shotRefs) {
    if (r.role === "start_frame") {
      tokenImages["@Start"] = r.url;
      tokenImages["@Image1"] = r.url;
    } else if (r.anchor) {
      tokenImages[r.anchor] = r.url;
    }
  }
  const current = versions[0] ?? null;
  // активный трек по умолчанию — семейство последней версии (для PromptTrackProvider)
  const initialPromptFamily = versions[0] ? promptFamily(versions[0].targetModel) : "seedance";
  // аспект из параметров последней версии — дефолт для шторки генерации.
  // Сериал вертикальный, поэтому дефолт — 9:16 (а не 16:9).
  let promptAspect = "9:16";
  try {
    promptAspect =
      (JSON.parse(versionRows[0]?.paramsJson || "{}") as { aspect_ratio?: string }).aspect_ratio ??
      "9:16";
  } catch {}
  // режиссёрские приёмы 🎥 текущей версии КАЖДОГО трека (Seedance/Kling)
  async function techniquesOf(row: (typeof versionRows)[number] | null) {
    if (!row) return [];
    let ids: string[] = [];
    try {
      ids = (JSON.parse(row.paramsJson || "{}") as { techniques?: string[] }).techniques ?? [];
    } catch {}
    return (await getTechniquesByIds(ids)).map((t) => ({
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
  }
  const usedTechniquesByFamily = {
    seedance: await techniquesOf(currentByFamily.seedance),
    kling: await techniquesOf(currentByFamily.kling),
  };

  const t = await getT();

  // start-frame кандидаты: рефы шота (start_frame первым) + референсы серии.
  // Листы-сетки исключены: 2×2/3×3 как первый кадр вертикального видео — брак.
  const startFrames = [
    ...shotRefs
      .slice()
      .sort((a, b) => (a.role === "start_frame" ? -1 : 0) - (b.role === "start_frame" ? -1 : 0))
      .map((r) => ({ id: r.id, url: r.url, label: r.caption || r.role })),
    ...seriesRefs
      .filter((r) => !r.isSheet)
      .map((r) => ({
        id: r.id,
        url: r.url,
        label: r.label,
        badge: r.sb ? t("раскадровка", "storyboard") : undefined,
      })),
  ];
  const defaultStartFrame = shotRefs.find((r) => r.role === "start_frame") ?? null;

  const imageModelsList = await availableImageModels();

  // библиотека режиссёрских приёмов — компактный список для ручного закрепления
  // приёма за шотом (пикер в GroupShotsEditor). Enhance проставляет их сам, но
  // теперь приём можно и добавить руками, не только снять (замечание заказчика).
  // Выключенные в библиотеке приёмы в пикер не попадают: в промпт они всё равно
  // не уедут, предлагать их нечестно.
  const techniqueLibrary = (await listEnabledTechniques()).map((tq) => ({
    id: tq.id,
    title: tq.title,
    category: tq.category,
    camera: tq.camera,
    tags: tq.tags,
  }));

  // Сущности + Референсы шота: раньше шли отдельными секциями ПОСЛЕ шотов группы.
  // Теперь их место — сразу после эмоционального тона (внутри GroupShotsEditor,
  // через topSlot); в ветке без группы (фрагмент сюжета) рендерим как раньше.
  const entitiesRefs = (
    <>
      <div className="flex flex-col gap-1.5">
        <SectionLabel
          hint={t("детали в кадр · обязательны в промпте", "details in frame · mandatory in prompt")}
        >
          {t("Якоря", "Anchors")}
        </SectionLabel>
        <AnchorsSection shotId={shotId} attached={attachedAnchors} available={availableAnchors} />
      </div>

      {/* сквозное физическое состояние: у вставных групп связки нет — секцию не показываем */}
      {!shot.isInsert && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel
            hint={t(
              "длящиеся факты сцены · разносятся по группам сами",
              "lasting facts of the scene · propagate across groups",
            )}
          >
            {t("Сквозное состояние", "Carried state")}
          </SectionLabel>
          <StateSection
            shotId={shotId}
            episodeId={episodeId}
            incoming={incomingState}
            begin={stateBegin}
            end={stateEnd}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <SectionLabel
          hint={t("определил Claude · правится вручную", "detected by Claude · editable")}
        >
          {t("Сущности", "Entities")}
        </SectionLabel>
        <EntityChips shotId={shotId} entities={entityChips} unlinked={unlinkedChars} />
      </div>

      {/* «Наборы стилей» убраны — фича не используется (замечание заказчика) */}

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
          imageModels={imageModelsList}
        />
      </div>
    </>
  );

  return (
    // Шапка, кинолента и master-колонка — в shots/(card)/layout.tsx: они общие
    // для серии и при переключении групп не перерисовываются. Здесь — только
    // деталь текущей группы.
    <PromptTrackProvider initialFamily={initialPromptFamily}>
      <GenPoller activeCount={activeCount} initialFp={await activityFingerprint()} />

      {/* detail (на десктопе справа резервируем место под панель действий) */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 pb-32 lg:pb-6 lg:pr-[212px]">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3.5">
              <div className="chrome-text font-display text-[46px] font-bold leading-[0.9] tracking-[0.03em]">
                {grpN}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <StatusPill status={shot.status} />
                {shot.isInsert && (
                  <span
                    title={t(
                      "вставная группа: своя шкала времени, свои локация/погода — в сквозной таймкод не входит",
                      "insert group: own clock, own location/weather — not part of the episode timecode",
                    )}
                    className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200"
                  >
                    {t("вставка", "insert")}
                  </span>
                )}
              </div>
              {/* Revert + Enhance — в шапке группы (замечание заказчика) */}
              <div className="flex shrink-0 items-center gap-2">
                <RevertButton shotId={shotId} />
                <EnhanceButton shotId={shotId} />
              </div>
            </div>
            {/* инфо-строка — отдельной строкой во всю ширину, чтобы не жалась в столбик
                между номером группы и кнопками на узком экране */}
            <div className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-t300">
              {shot.timecode ? `${shot.timecode} · ` : ""}
              {shot.durationSec} {t("сек", "sec")}
              {mainBeats.length ? ` · ${t("шотов", "shots")} ${mainBeats.length}` : ""}
              {beats.length > mainBeats.length
                ? ` (+${beats.length - mainBeats.length} draft)`
                : ""}{" "}
              ·{" "}
              {versions.length
                ? `${t("промпт", "prompt")} v${current!.version}`
                : t("промпта нет", "no prompt")}{" "}
              · {t("видео", "videos")} {results.filter((r) => r.status === "done").length}
            </div>
          </div>

          {/* граница сюжетной сцены: тумблер «новая сцена / продолжение».
              У вставной группы границ сцен нет — тумблер не показываем */}
          {!shot.isInsert && (
            <SceneToggle
              shotId={shotId}
              sceneStart={shot.sceneStart}
              isFirst={shotIdx === 0}
              prevGroupNo={prevShot ? String(prevShot.orderIndex).padStart(2, "0") : null}
            />
          )}

          {beats.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <SectionLabel
                hint={t("правятся вручную · замечание уходит в Claude", "edit by hand · feedback goes to Claude")}
              >
                {t("Шоты группы", "Group shots")}
              </SectionLabel>
              <GroupShotsEditor
                shotId={shotId}
                initialBeats={beats}
                llmModel={settings.llm_model}
                location={chainLocation(rows, shotId)}
                timeWeather={chainTimeWeather(rows, shotId)}
                emotionalTone={shot.emotionalTone}
                techniqueLibrary={techniqueLibrary}
                refThumbs={shotRefs.map((r) => ({
                  id: r.id,
                  url: r.url,
                  role: r.role,
                  anchor: r.anchor,
                }))}
                topSlot={entitiesRefs}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <SectionLabel>{t("Фрагмент сюжета", "Story fragment")}</SectionLabel>
                <EditableAction shotId={shotId} initial={shot.actionMd} cameraHint={shot.cameraHint} />
              </div>
              {entitiesRefs}
            </>
          )}

          {/* промпт: десктоп — инлайн, мобайл — правый слайдер c FAB (блок при
              этом всегда смонтирован — см. PromptDrawer) */}
          <PromptDrawer>
            <PromptBlock
              shotId={shotId}
              episodeId={episodeId}
              versions={versions}
              versionCountByFamily={versionCountByFamily}
              tokens={tokens}
              tokenImages={tokenImages}
              llmModel={settings.llm_model}
              usedTechniquesByFamily={usedTechniquesByFamily}
              useCli={settings.llm_use_cli === "1"}
              useCliGpt={settings.llm_use_cli_gpt === "1"}
              seedanceModelId={seedanceModelId}
              groupDurationSec={shot.durationSec}
            />
          </PromptDrawer>

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
            {/* ручное добавление видео, «выпавшего» из генерации (туннель потерял
                результат провайдера) — тот же путь, что и провайдер: /api/upload kind=result */}
            <UploadButton
              kind="result"
              shotId={shotId}
              label={t("＋ Добавить видео вручную (mp4)", "＋ Add video manually (mp4)")}
              className="mt-1 flex min-h-10 w-full items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] px-3 text-[11px] font-semibold text-t300 hover:border-[var(--border-strong)] hover:text-violet-200 disabled:opacity-50"
            />
          </div>
      </div>

      {/* обе кнопки ActionBar — position:fixed, поэтому в сетке layout'а он вне
          потока и колонок не занимает */}
      <ActionBar
        episodeId={episodeId}
        shotId={shotId}
        promptFamilies={{
          seedance: Boolean(currentByFamily.seedance),
          kling: Boolean(currentByFamily.kling),
        }}
        hasPrompt={Boolean(current)}
        models={catalog}
        defaultModelIds={defaultModelIds}
        startFrames={startFrames}
        groupDurationSec={shot.durationSec}
        aspectRatio={promptAspect}
        defaultStartFrameId={defaultStartFrame?.id ?? null}
        latestByFamily={{
          seedance: currentByFamily.seedance?.version,
          kling: currentByFamily.kling?.version,
        }}
        versionById={Object.fromEntries(promptVersionById)}
      />
    </PromptTrackProvider>
  );
}
