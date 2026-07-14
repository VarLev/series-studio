import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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
import { getFileUrl, getFileUrls } from "@/lib/storage";
import { thumbForResult } from "@/lib/poster";
import { getAllSettings } from "@/lib/settings";
import { getCatalog, availableImageModels } from "@/lib/generation";
import { getTechniquesByIds, listTechniques } from "@/lib/director";
import type { GroupShot } from "@/lib/llm/contracts";
import { promptFamily } from "@/lib/llm/models";
import { getT } from "@/lib/i18n-server";
import { ScreenHeader, StatusPill, SectionLabel, EmptyState, SHOT_STATUS } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteAllGenerations, deleteShot } from "@/lib/actions/deletes";
import EntityChips from "@/components/shot/EntityChips";
import AnchorsSection from "@/components/shot/AnchorsSection";
import ShotRefs from "@/components/shot/ShotRefs";
import PromptBlock from "@/components/shot/PromptBlock";
import PromptDrawer from "@/components/shot/PromptDrawer";
import PromptTrackProvider from "@/components/shot/PromptTrackContext";
import ActionBar from "@/components/shot/ActionBar";
import EditableAction from "@/components/shot/EditableAction";
import EnhanceButton from "@/components/shot/EnhanceButton";
import GroupShotsEditor from "@/components/shot/GroupShotsEditor";
import SceneToggle from "@/components/shot/SceneToggle";
import ResultsStrip from "@/components/shot/ResultsStrip";
import ShotHotkeys from "@/components/shot/ShotHotkeys";
import GenPoller from "@/components/GenPoller";
import FilmStrip from "@/components/FilmStrip";
import { chainLocation, chainTimeWeather, displayGroupNumbers } from "@/lib/beats";
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
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));

  // шоты внутри группы (раскадровка v2); у старых групп beats_json пуст
  let beats: GroupShot[] = [];
  try {
    const parsed = JSON.parse(shot.beatsJson || "[]");
    if (Array.isArray(parsed)) beats = parsed as GroupShot[];
  } catch {}
  // основные шоты (Main): длительность/промпт/счётчики; черновики — запаски
  const mainBeats = beats.filter((b) => !b.draft);

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
  // референс-миниатюра шота (фолбэк, если готового видео ещё нет): по одному рефу
  // на шот (start_frame вперёд), URL'ы — одним батчем (getFileUrls), а не циклом
  // последовательных подписей. slice() — чтобы не мутировать массив (ниже он ещё
  // нужен для shotRefRows); валидный компаратор (битый однорукий давал случайный
  // порядок — миниатюрой мог стать не start_frame).
  const thumbRefByShot = new Map<string, string>(); // shotId → storage_path
  for (const ref of shotRefsAll
    .slice()
    .sort((a, b) => (a.role === "start_frame" ? -1 : 0) - (b.role === "start_frame" ? -1 : 0))) {
    if (ref.shotId && !thumbRefByShot.has(ref.shotId)) {
      thumbRefByShot.set(ref.shotId, ref.storagePath);
    }
  }
  const thumbEntries = [...thumbRefByShot.entries()];
  const thumbUrls = await getFileUrls(thumbEntries.map(([, p]) => p));
  const thumbByShot = new Map<string, string>(
    thumbEntries.map(([shotId], i) => [shotId, thumbUrls[i]]),
  );
  // основная миниатюра киноленты = кадр ФАКТИЧЕСКОГО видео: последний утверждённый
  // (★), иначе первый готовый результат (совпадает с логикой списка шотов серии)
  // узкие колонки (не тянем килобайтные params_json) + фильтр «готовый результат» в SQL
  const stripGens = shotIds.length
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
            inArray(generations.shotId, shotIds),
            eq(generations.status, "done"),
            isNotNull(generations.resultStoragePath),
          ),
        )
    : [];
  // миниатюра киноленты: постер-jpg видео, если есть рядом, иначе само видео
  const videoThumbByShot = new Map<string, { url: string; isVideo: boolean }>();
  for (const s of allShots) {
    const arr = stripGens
      .filter((g) => g.shotId === s.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!arr.length) continue;
    const winners = arr.filter((g) => g.winner);
    const best = winners.length ? winners[winners.length - 1] : arr[0];
    videoThumbByShot.set(s.id, await thumbForResult(best.resultStoragePath!));
  }
  // номер группы в серии: вставные группы (isInsert) в нумерацию не входят
  const displayNoById = displayGroupNumbers(allShots);
  const stripShots = allShots.map((s, i) => {
    const vt = videoThumbByShot.get(s.id);
    return {
      id: s.id,
      orderIndex: s.orderIndex,
      displayNo: displayNoById.get(s.id) ?? 0,
      isInsert: s.isInsert,
      status: s.status,
      // сперва кадр видео, иначе референс шота
      thumbUrl: vt?.url ?? thumbByShot.get(s.id) ?? null,
      thumbIsVideo: vt?.isVideo ?? false,
      sceneStart: i === 0 || s.sceneStart,
    };
  });
  const shotIdx = allShots.findIndex((s) => s.id === shotId);
  const prevShot = allShots[shotIdx - 1] ?? null;
  const nextShot = allShots[shotIdx + 1] ?? null;

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

  // референсы шота (с ролями); порядок createdAt = порядок якорей @Comp1..N
  // (тот же порядок использует generation.ts при прикреплении картинок к задаче)
  const shotRefRows = shotRefsAll
    .filter((r) => r.shotId === shotId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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

  const epN = String(episode?.number ?? 0).padStart(2, "0");
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

  // start-frame кандидаты: рефы шота (start_frame первым) + референсы серии
  const startFrames = [
    ...shotRefs
      .slice()
      .sort((a, b) => (a.role === "start_frame" ? -1 : 0) - (b.role === "start_frame" ? -1 : 0))
      .map((r) => ({ id: r.id, url: r.url, label: r.caption || r.role })),
    ...seriesRefs.map((r) => ({ id: r.id, url: r.url, label: r.label })),
  ];
  const defaultStartFrame = shotRefs.find((r) => r.role === "start_frame") ?? null;

  const shotHref = (s: { id: string }) => `/episodes/${episodeId}/shots/${s.id}`;

  const t = await getT();
  const imageModelsList = await availableImageModels();
  const grpLabel = shot.isInsert ? t("Вставка", "Insert") : `${t("Группа", "Group")} ${grpN}`;

  // библиотека режиссёрских приёмов — компактный список для ручного закрепления
  // приёма за шотом (пикер в GroupShotsEditor). Enhance проставляет их сам, но
  // теперь приём можно и добавить руками, не только снять (замечание заказчика).
  const techniqueLibrary = (await listTechniques()).map((tq) => ({
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

      <div className="flex flex-col gap-1.5">
        <SectionLabel
          hint={t("определил Claude · правится вручную", "detected by Claude · editable")}
        >
          {t("Сущности", "Entities")}
        </SectionLabel>
        <EntityChips shotId={shotId} entities={entityChips} />
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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl lg:h-dvh lg:min-h-0 lg:max-w-none lg:overflow-hidden">
      <ScreenHeader
        backHref={`/episodes/${episodeId}`}
        eyebrow={`${t("Серия", "Episode")} ${epN} · ${grpLabel}`}
        title={shot.title || t("Группа шотов", "Shot group")}
        right={
          // очередь убрана из шапки — нижний таб-бар с бейджем теперь на всех экранах
          shot.isInsert ? (
            <ConfirmButton
              action={deleteShot.bind(null, shotId)}
              label={t("Удалить вставку", "Delete insert")}
              confirmLabel={t("Точно удалить эту вставную группу?", "Really delete this insert group?")}
              className="min-h-8 rounded-full border border-[rgba(194,71,106,.4)] bg-ink-600 px-3 py-1.5 font-mono text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
              armedClassName="border-danger bg-[rgba(194,71,106,.15)] text-[#e08aa4]"
            />
          ) : undefined
        }
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

      <PromptTrackProvider initialFamily={initialPromptFamily}>
      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[280px_1fr]">
        {/* master-колонка (spec §4, десктоп) */}
        <aside className="hidden overflow-y-auto border-r border-[var(--border-subtle)] p-3 lg:block">
          <div className="section-label mb-2">{t("Шоты серии", "Episode shots")}</div>
          <div className="flex flex-col gap-1.5">
            {allShots.map((s) => {
              const st = SHOT_STATUS[s.status] ?? SHOT_STATUS.draft;
              const active = s.id === shotId;
              const sLabel = s.isInsert ? "✦" : String(displayNoById.get(s.id) ?? 0).padStart(2, "0");
              return (
                <Link
                  key={s.id}
                  href={shotHref(s)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                    s.isInsert ? "border-dashed" : ""
                  }`}
                  style={{
                    borderColor: active
                      ? "var(--border-strong)"
                      : s.isInsert
                        ? "rgba(139,95,176,.5)"
                        : "var(--border-subtle)",
                    background: active
                      ? "var(--ink-600)"
                      : s.isInsert
                        ? "rgba(139,95,176,.08)"
                        : "none",
                  }}
                >
                  <span
                    className="chrome-text font-display text-[13px] font-bold"
                    style={s.isInsert ? { color: "var(--violet-300)" } : undefined}
                  >
                    {sLabel}
                  </span>
                  {s.isInsert ? (
                    <span
                      className="rounded bg-[rgba(139,95,176,.18)] px-1 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.08em] text-violet-200"
                      title={t("Вставная группа", "Insert group")}
                    >
                      {t("вставка", "insert")}
                    </span>
                  ) : (
                    (s.sceneStart || allShots[0]?.id === s.id) && (
                      <span className="text-[10px] leading-none" title={t("Начало сцены", "Scene start")}>
                        🎬
                      </span>
                    )
                  )}
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
              <div className="flex items-center gap-1.5">
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
            {/* Enhance — в шапке группы (перенос из блока шотов, замечание заказчика) */}
            <EnhanceButton shotId={shotId} />
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
                location={chainLocation(allShots, shotId)}
                timeWeather={chainTimeWeather(allShots, shotId)}
                emotionalTone={shot.emotionalTone}
                techniqueLibrary={techniqueLibrary}
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
          </div>
        </div>
      </div>

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
      />
      </PromptTrackProvider>
    </main>
  );
}
