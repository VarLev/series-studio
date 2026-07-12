/**
 * Промпт-фабрика (M3) и LLM-вызовы M2 — системные промпты собираются из:
 * правил проекта (settings) + релевантных выдержек базы знаний + библии сущностей.
 */
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import {
  getDb,
  entities,
  knowledgeDocs,
  prompts,
  references,
  shots,
  shotEntities,
} from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { readFile } from "@/lib/storage";
import { TIMING_RULES, LANGUAGE_RULES } from "@/lib/templates";
import { listTechniques, techniqueIndex, getTechniquesByIds } from "@/lib/director";
import { effectiveOutfit } from "@/lib/wardrobe";
import { promptFamily, visionModelFrom } from "./models";
import { runJson } from "./client";
import {
  breakdownSchema,
  groupPatchSchema,
  imageAnalysisSchema,
  shotPromptSchema,
  techniquePickSchema,
  type Breakdown,
  type GroupPatch,
  type GroupShot,
  type ImageAnalysis,
  type ShotPrompt,
} from "./contracts";

async function seriesSystemBase(): Promise<{ rules: string; model: string }> {
  const s = await getAllSettings();
  return {
    rules: `Сериал «${s.series_title}». Правила сериала:\n${s.series_rules}`,
    model: s.llm_model,
  };
}

/**
 * Контекст библии для модели. Описание — короткий визуальный якорь (одна фраза),
 * и он подаётся ЭКОНОМНО, чтобы не перегружать промпт при 4–5 персонажах в кадре:
 *  - mode "names" (разбивка/правка групп): только имена/@токены/типы — внешность
 *    структуре истории не нужна (вариант A);
 *  - mode "prompt" (промпт шота): у кого есть полноценный референс (не «только
 *    лицо») — облик несёт картинка, текст внешности НЕ шлём (вариант C);
 *    у остальных — короткий якорь-описание (вариант D).
 */
async function bibleContext(
  entityIds: string[] | undefined,
  opts: { mode: "names" | "prompt" } = { mode: "prompt" },
): Promise<string> {
  const db = await getDb();
  const rows = entityIds?.length
    ? await db.select().from(entities).where(inArray(entities.id, entityIds))
    : await db.select().from(entities).where(eq(entities.archived, false));
  if (!rows.length) return "Библия сущностей пока пуста.";

  const header = "Библия сериала (element_name — канонические имена для промптов):\n";

  if (opts.mode === "names") {
    return (
      header +
      rows.map((e) => `- [${e.type}] ${e.name} (element_name: "${e.elementName}")`).join("\n")
    );
  }

  // облик несёт приложенный референс (кроме помеченных «только лицо») → внешность не дублируем
  const fullRef = new Set<string>();
  const refRows = await db
    .select({ entityId: references.entityId, role: references.role })
    .from(references)
    .where(inArray(references.entityId, rows.map((e) => e.id)));
  for (const r of refRows) if (r.entityId && r.role !== "face") fullRef.add(r.entityId);

  return (
    header +
    rows
      .map((e) =>
        fullRef.has(e.id)
          ? `- [${e.type}] ${e.name} (element_name: "${e.elementName}") — облик задаёт приложенный референс`
          : `- [${e.type}] ${e.name} (element_name: "${e.elementName}")${e.description ? `: ${e.description}` : ""}`,
      )
      .join("\n")
  );
}

async function knowledgeContext(targetModel: string): Promise<string> {
  const db = await getDb();
  const docs = await db.select().from(knowledgeDocs);
  const modelKey = targetModel.toLowerCase().split(/[-\s]/)[0]; // kling / seedance / grok...
  const relevant = docs.filter((d) => {
    const tags = d.tags.toLowerCase();
    return tags.includes(modelKey) || tags.includes("general") || tags.includes("camera");
  });
  if (!relevant.length) return "";
  const excerpts = relevant
    .map((d) => `### ${d.title}\n${d.contentMd.slice(0, 6000)}`)
    .join("\n\n");
  return `База знаний по промптам:\n${excerpts}`;
}

/**
 * M2 — разбить готовый литературный сюжет на группы шотов (JSON).
 * Творческое задание — редактируемый шаблон заказчика (tpl_breakdown, настройки);
 * JSON-контракт добавляется программно и не зависит от правок шаблона.
 */
export async function llmBreakdown(
  episodeId: string,
  synopsis: string,
  modelOverride?: string,
  duration?: { min: number; max: number },
): Promise<Breakdown> {
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext(undefined, { mode: "names" });
  const settings = await getAllSettings();
  // диапазон хронометража эпизода задаётся бегунком на вкладке «Сюжет» (дефолт 3–5 мин)
  const durMin = duration?.min ?? 3;
  const durMax = duration?.max ?? 5;
  const durPhrase = durMin === durMax ? `${durMin} минут` : `${durMin}–${durMax} минут`;
  const user = settings.tpl_breakdown
    .replaceAll("{{STORY}}", synopsis)
    .replaceAll("[ВСТАВИТЬ ТЕКСТ]", synopsis)
    .replaceAll("{{DURATION}}", durPhrase)
    // старые сохранённые шаблоны с зашитым «N–M минут» — подменяем на выбранный диапазон
    .replace(/(продолжительность эпизода:\s*)\d+\s*[–—-]\s*\d+\s*минут/i, `$1${durPhrase}`);
  return runJson(
    {
      kind: "breakdown",
      model: modelOverride || model,
      episodeId,
      maxTokens: 24000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Выполни задание пользователя (раскадровка эпизода), но результат верни НЕ markdown-текстом, " +
        "а ТОЛЬКО одним JSON-объектом без пояснений:\n" +
        '{"summary":"краткий сюжет эпизода","characters":["персонажи"],"locations":["локации"],' +
        '"groups":[{"order":1,"title":"название группы","time":"00:00–00:14","duration_sec":14,' +
        '"location":"локация группы","scene_start":true,"characters":["персонажи группы"],' +
        '"wardrobe":[{"name":"персонаж","outfit":"наряд ТОЛЬКО если сюжет его описал для этой сцены, иначе пустая строка, НА АНГЛИЙСКОМ"}],' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"точная реплика или пустая строка"}]}]}\n' +
        "СЦЕНЫ (границы сюжетных сцен): scene_start: true — если группа начинает НОВУЮ сюжетную " +
        "сцену: смена локации, скачок во времени или разрыв непрерывности действия. Если группа — " +
        "прямое продолжение предыдущей (та же обстановка, действие течёт без разрыва) — scene_start: false. " +
        "Первая группа эпизода — всегда scene_start: true.\n" +
        "ГАРДЕРОБ (якорь одежды): НЕ придумывай одежду. По умолчанию у каждого персонажа " +
        "есть базовый гардероб в библии — приложение подставит его само, поэтому в обычном " +
        "случае outfit оставляй ПУСТОЙ СТРОКОЙ. Заполняй outfit (на английском, годный для " +
        'видеопромпта, например "charcoal wool coat over white shirt, black jeans") ТОЛЬКО ' +
        "если сам сюжет явно описывает, во что персонаж одет в этой сцене или что он " +
        "переоделся (например «надела красное платье», «теперь в строгом костюме»). Если " +
        "сюжет одежду не упоминает — outfit пустой. Когда сцена (scene_start: false) " +
        "продолжается, а сюжет ранее задал наряд — повтори тот же наряд ДОСЛОВНО во всех " +
        "группах этой сцены; на границе сцены обновляй, только если сюжет описал переодевание.\n" +
        "Соответствие формату задания: группа = «# ГРУППА NN» (не длиннее 15 секунд, пригодна для " +
        "отдельной AI-видеогенерации), shots = «### Шот N» внутри группы, duration_sec — длительность " +
        "группы в секундах. Время шотов (shots[].time) отсчитывается ОТ НАЧАЛА ГРУППЫ: первый шот " +
        "каждой группы начинается с 00:00. Время группы (time) — сквозное по эпизоду. " +
        "Все правила задания (хронометраж, реплики, планы) действуют.\n" +
        `Целевая продолжительность всего эпизода: ${durPhrase}. Это значение приоритетно — оно ` +
        "заменяет любую другую длительность эпизода, упомянутую в задании; распредели события так, " +
        "чтобы суммарный хронометраж уложился в этот диапазон.\n" +
        `${LANGUAGE_RULES}`,
      user,
    },
    breakdownSchema,
  );
}

/**
 * Переделать одну группу шотов по замечанию пользователя: модель получает
 * ТОЛЬКО шоты этой группы + краткий контекст соседних групп (не весь сюжет!) и
 * замечание — возвращает обновлённую группу тем же JSON-форматом (время от 00:00).
 * targetOrders — если задан, переделывать разрешено ТОЛЬКО эти шоты (остальные
 * вернуть дословно); если пуст — модель сама решает, каких шотов касается замечание.
 */
export async function llmReviseGroup(input: {
  episodeId: string;
  /** краткий контекст: что в соседних группах (НЕ весь сюжет эпизода) */
  contextFragment: string;
  groupTitle: string;
  durationSec: number;
  beats: GroupShot[];
  feedback: string;
  targetOrders?: number[];
  model?: string;
}): Promise<GroupPatch> {
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext(undefined, { mode: "names" });
  const current =
    `Группа «${input.groupTitle}» (${input.durationSec} сек):\n` +
    input.beats
      .map(
        (b) =>
          `Шот ${b.order} (${b.time}): План/ракурс: ${b.framing}. Камера видит: ${b.camera}. ` +
          `Действие: ${b.action}.${b.dialogue ? ` Реплика: «${b.dialogue}»` : ""}`,
      )
      .join("\n");
  const scope = input.targetOrders?.length
    ? `ОБЛАСТЬ ПРАВКИ: переделай ТОЛЬКО шоты с номерами [${input.targetOrders.join(", ")}] по замечанию. ` +
      "Все остальные шоты верни в ответе БЕЗ ИЗМЕНЕНИЙ — дословно (те же order, framing, camera, action, dialogue). " +
      "Не добавляй и не удаляй шоты, сохрани их количество и порядок.\n"
    : "ОБЛАСТЬ ПРАВКИ: сам определи, каких шотов касается замечание, и меняй только их; шоты, " +
      "которых замечание не касается, верни без изменений. Количество шотов меняй только если этого прямо требует замечание.\n";
  return runJson(
    {
      kind: "breakdown",
      model: input.model || model,
      episodeId: input.episodeId,
      maxTokens: 8000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты правишь ОДНУ группу шотов раскадровки вертикального сериала (группа = отдельное " +
        "AI-видео не длиннее 15 секунд). Перепиши её с учётом замечания, сохранив рабочие части.\n" +
        scope +
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n` +
        "Верни ТОЛЬКО JSON без пояснений (ВСЕ шоты группы, включая неизменённые):\n" +
        '{"title":"название группы","duration_sec":14,' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"точная реплика или пустая строка"}]}\n' +
        "Время шотов отсчитывается от начала группы (первый шот с 00:00).",
      user:
        (input.contextFragment.trim()
          ? `Контекст соседних групп (НЕ переписывай их, только для связности):\n${input.contextFragment}\n\n`
          : "") +
        `Текущая группа (правишь только её):\n${current}\n\n` +
        `Замечание пользователя: ${input.feedback}`,
    },
    groupPatchSchema,
  );
}

/**
 * Этап 1 фабрики: Haiku просматривает индекс библиотеки приёмов (500 карточек)
 * и выбирает до 5 кандидатов под действие шота. Дёшево (~1 цент), полные тексты
 * кандидатов идут во второй, основной вызов.
 */
async function pickTechniqueCandidates(
  episodeId: string,
  shotDescription: string,
  model: string,
): Promise<string[]> {
  const all = await listTechniques();
  if (!all.length) return [];
  try {
    const res = await runJson(
      {
        kind: "prompt",
        model,
        episodeId,
        maxTokens: 500,
        system:
          "Ты подбираешь режиссёрские приёмы к сцене вертикального сериала. " +
          "Ниже индекс библиотеки: id | название | камера | теги | категория. " +
          "Выбери до 5 приёмов, которые реально усилят сцену (движение камеры, свет, композиция). " +
          "Если ничего не подходит — верни пустой список.\n" +
          'Верни ТОЛЬКО JSON: {"ids":["b19"]}\n\n' +
          techniqueIndex(all),
        user: `Сцена: ${shotDescription}`,
      },
      techniquePickSchema,
    );
    const known = new Set(all.map((t) => t.id));
    return res.ids.filter((id) => known.has(id)).slice(0, 5);
  } catch {
    // подбор приёмов — вспомогательный шаг: его сбой не должен ломать фабрику
    return [];
  }
}

/**
 * Инварианты шаблона (предпочтения §7): vertical 9:16 и запрет субтитров
 * должны быть в каждом видео-промпте — гарантируем программно, а не надеждой на LLM.
 */
function enforceTemplateInvariants(res: ShotPrompt): ShotPrompt {
  const tail: string[] = [];
  if (!/9\s*:\s*16/.test(res.prompt)) tail.push("Format: vertical 9:16.");
  if (!/no subtitles/i.test(res.prompt)) tail.push("No subtitles. No text overlays.");
  if (tail.length) res.prompt = `${res.prompt.trimEnd()}\n\n${tail.join("\n")}`;
  res.params.aspect_ratio = "9:16"; // сериал вертикальный
  return res;
}

/** M3 — сгенерировать промпт для шота под целевую модель (JSON).
 *  modelOverride — какой ИИ пишет промпт (выбор на карточке шота). */
export async function llmShotPrompt(
  shotId: string,
  targetModel: string,
  modelOverride?: string,
): Promise<ShotPrompt> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) throw new Error("Шот не найден");
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const settings = await getAllSettings();
  const { rules, model: defaultModel } = await seriesSystemBase();
  const model = modelOverride || defaultModel;
  const bible = await bibleContext(links.map((l) => l.entityId));
  const knowledge = await knowledgeContext(targetModel);
  const isKling = promptFamily(targetModel) === "kling";
  // у каждого семейства свой шаблон: Seedance (tpl_video) и Kling (tpl_video_kling —
  // референсы <<<image_N>>>, нативный звук, своя структура шотов)
  const videoTemplate = isKling ? settings.tpl_video_kling : settings.tpl_video;

  const shotDescription =
    `${shot.title ? shot.title + ". " : ""}${shot.actionMd}` +
    (shot.cameraHint ? ` Камера: ${shot.cameraHint}.` : "") +
    ` Длительность ${shot.durationSec} сек.`;

  // ---------- гардероб группы (WARDROBE LOCK) ----------
  // наряд из связки шот×персонаж; пусто → базовый гардероб сущности
  const linkedEntities = links.length
    ? await db.select().from(entities).where(inArray(entities.id, links.map((l) => l.entityId)))
    : [];
  const characterRows = linkedEntities.filter((e) => e.type === "character");
  // одежда для промпта: по умолчанию базовый гардероб из библии; сценарный наряд
  // (outfit) — только если он помечен источником "generated" (см. effectiveOutfit)
  const linkByEntity = new Map(links.map((l) => [l.entityId, l]));
  const outfits = characterRows
    .map((e) => ({ e, outfit: effectiveOutfit(linkByEntity.get(e.id), e.wardrobe) }))
    .filter((x) => x.outfit);
  // референсы «только лицо»: основной (первый) реф персонажа помечен role=face
  const charRefs = characterRows.length
    ? await db
        .select()
        .from(references)
        .where(inArray(references.entityId, characterRows.map((c) => c.id)))
        .orderBy(asc(references.createdAt))
    : [];
  const faceOnly = characterRows.filter(
    (c) => charRefs.find((r) => r.entityId === c.id)?.role === "face",
  );

  // ---------- стартовый кадр: упоминается в промпте ТОЛЬКО если реально прикреплён ----------
  // (инцидент: шаблон показывает строку "Use @Image1 …" в примере структуры, и модель
  // писала её даже без прикреплённого кадра)
  const shotRefs = await db.select().from(references).where(eq(references.shotId, shotId));
  const hasStartFrame = shotRefs.some((r) => r.role === "start_frame");
  const startAnchor = isKling ? "@Start" : "@Image1";
  const startFrameBlock = hasStartFrame
    ? `СТАРТОВЫЙ КАДР: к группе прикреплён стартовый кадр — сошлись на него ровно одной строкой ` +
      `"Use ${startAnchor} as the locked starting frame." в начале промпта и больше его не упоминай.`
    : `СТАРТОВЫЙ КАДР: к этой группе стартовый кадр НЕ прикреплён — НЕ упоминай ${startAnchor}, ` +
      `@Start, @Image1 или "starting frame" вообще, даже если шаблон выше показывает такую строку в примере.`;

  // ---------- сюжетная сцена: непрерывность или чистый лист ----------
  // первая группа эпизода — всегда начало сцены; иначе смотрим флаг scene_start
  const [prevGroup] = await db
    .select()
    .from(shots)
    .where(and(eq(shots.episodeId, shot.episodeId), lt(shots.orderIndex, shot.orderIndex)))
    .orderBy(desc(shots.orderIndex))
    .limit(1);
  let sceneBlock = "";
  if (!prevGroup || shot.sceneStart) {
    sceneBlock =
      "НОВАЯ СЦЕНА: эта группа начинает новую сюжетную сцену. НЕ привязывайся к обстановке, " +
      "свету, времени суток или действию предыдущих групп — постоянные якоря только персонажи " +
      "и локации из библии (и их референсы).";
  } else {
    // краткое содержание предыдущей группы: шоты из раскадровки либо actionMd
    let prevDigest = "";
    try {
      const parsed = JSON.parse(prevGroup.beatsJson || "[]") as Array<{ action?: string }>;
      if (Array.isArray(parsed)) {
        prevDigest = parsed.map((b) => b.action || "").filter(Boolean).join(" ");
      }
    } catch {}
    if (!prevDigest) prevDigest = prevGroup.actionMd;
    sceneBlock =
      `ПРОДОЛЖЕНИЕ СЦЕНЫ: эта группа — прямое продолжение группы «${prevGroup.title}» ` +
      `(её содержание: ${prevDigest.slice(0, 400)}). Сохрани ту же локацию, время суток, свет, ` +
      "погоду и одежду персонажей; действие продолжается без разрыва.";
  }

  const wardrobeBlock =
    outfits.length || faceOnly.length
      ? "ГАРДЕРОБ ГРУППЫ (жёсткий якорь одежды):\n" +
        [
          ...outfits.map((x) => `- ${x.e.name} (${x.e.elementName}): ${x.outfit}`),
          ...faceOnly.map(
            (c) =>
              `- ${c.elementName}: референс — ТОЛЬКО ЛИЦО; его ЕДИНСТВЕННАЯ identity-строка: ` +
              `"Use ${c.elementName} for face and identity only; clothing per WARDROBE LOCK."`,
          ),
        ].join("\n") +
        "\nПравила гардероба: включи в промпт блок WARDROBE LOCK с этой одеждой " +
        "(дословно, на английском) и правилом «clothing must remain identical in every shot»; " +
        "не выдумывай и не меняй предметы одежды; в SHOT-блоках одежду не пересказывай."
      : "";

  // структура шотов группы из раскадровки v2: тайминг/план/камера/действие/реплика
  let beats: GroupShot[] = [];
  try {
    const parsed = JSON.parse(shot.beatsJson || "[]");
    if (Array.isArray(parsed)) beats = parsed as GroupShot[];
  } catch {}
  const beatsBlock = beats.length
    ? "Шоты группы по раскадровке (соблюдай их тайминг и порядок в SHOT-блоках промпта):\n" +
      beats
        .map(
          (b) =>
            `Шот ${b.order}${b.time ? ` (${b.time})` : ""}:` +
            (b.framing ? ` План/ракурс: ${b.framing}.` : "") +
            (b.camera ? ` Камера видит: ${b.camera}.` : "") +
            (b.action ? ` Действие: ${b.action}.` : "") +
            (b.dialogue ? ` Реплика: «${b.dialogue}»` : ""),
        )
        .join("\n")
    : "";
  const candidateIds = await pickTechniqueCandidates(
    shot.episodeId,
    shotDescription,
    settings.llm_simple_model,
  );
  const candidates = await getTechniquesByIds(candidateIds);
  const techniquesBlock = candidates.length
    ? "БИБЛИОТЕКА РЕЖИССЁРСКИХ ПРИЁМОВ (кандидаты под эту сцену):\n" +
      candidates
        .map(
          (t) =>
            `### ${t.id} · ${t.title} (${t.camera}${t.lens ? `, ${t.lens}` : ""})\n${t.prompt}` +
            (t.negative ? `\nNegative: ${t.negative}` : ""),
        )
        .join("\n\n") +
      "\n\nДля каждого шота внутри промпта реши, применим ли какой-то приём из кандидатов: " +
      "если да — интегрируй его язык камеры/света/композиции в промпт (адаптируя под сцену и персонажей) " +
      "и добавь id в used_technique_ids; если ни один не подходит — придумай своё режиссёрское решение " +
      "и оставь used_technique_ids пустым."
    : "";

  // Компактность: рекомендация Seedance — до 3500 символов; лишние повторы и
  // «декоративные» запреты только съедают внимание модели. Программный блок —
  // не зависит от правок шаблона пользователем.
  const compactBlock =
    "КОМПАКТНОСТЬ ПРОМПТА (обязательно):\n" +
    "- Весь промпт — не длиннее 3500 символов. Плотно, без воды.\n" +
    '- На персонажа ровно ОДНА identity-строка: "Use @Name as the locked identity reference." ' +
    "(или face-only вариант из блока гардероба). Никаких тавтологий вида " +
    '"Use @X as the locked identity for @X" и никаких повторных строк про тот же референс.\n' +
    "- Локация, время суток, свет, атмосфера и одежда фиксируются ОДИН раз в GLOBAL CONTINUITY — " +
    "в SHOT-блоках пиши только то, что меняется (ракурс, действие, реплика); поля Location/Lighting " +
    "в шоте опускай, если они не изменились.\n" +
    "- Каждый запрет — один раз. Strict rules: не более 5 строк, только специфичное для этой сцены; " +
    "не повторяй то, что уже зафиксировано в GLOBAL CONTINUITY, WARDROBE LOCK, DIALOGUE LOCK или Framing.\n" +
    "- Не добавляй декларации без визуального смысла и дублирующиеся эпитеты атмосферы в каждом блоке.";

  return runJson(
    {
      kind: "prompt",
      model,
      episodeId: shot.episodeId,
      maxTokens: 8000,
      // шаблон видео-промпта заказчика (настройки, свой на семейство) — основа системной инструкции
      system:
        `${videoTemplate}\n\n${rules}\n\n${bible}\n\n${sceneBlock}\n\n${startFrameBlock}\n\n${wardrobeBlock}\n\n${knowledge}\n\n${techniquesBlock}\n\n${compactBlock}\n\n` +
        `Составь промпт для модели ${targetModel} на английском языке, СТРОГО следуя структуре ` +
        "видео-промпта из шаблона выше (для простой сцены без диалога допустим короткий шаблон). " +
        "Обязательно включи в текст промпта: Format: vertical 9:16; Duration; No subtitles. No text overlays; " +
        "блоки Scene/Action/Performance/Camera/Audio/Strict rules; если есть реплика — DIALOGUE LOCK с точным текстом. " +
        (isKling
          ? "Промпт для Kling 3.0 Omni: персонажей обозначай их element_name (@Name), стартовый кадр — @Start; " +
            "приложение заменит якоря на токены <<<image_N>>> при отправке. Звук нативный — реплики в кавычках " +
            "с тоном в скобках, эмбиент и SFX описывай в каждом шоте (тишина задаётся явно). "
          : "") +
        "Весь промпт — ТОЛЬКО на английском, независимо от языка исходного материала. Все имена " +
        "собственные (персонажи, локации, бренды) — латиницей по-английски; для сущностей библии " +
        "используй их element_name. Реплики в DIALOGUE LOCK — на английском (переведи, если в " +
        "исходнике они на другом языке).\n" +
        "Используй element_name сущностей как визуальные якоря. В reference_element_names перечисли " +
        "element_name сущностей, чьи референсы нужно прикрепить к задаче.\n" +
        "Идентичность персонажей несут их референсы (element/image) — в тексте промпта ссылайся на " +
        "element_name и НЕ переписывай их внешность подробно. Описывай действие, эмоцию, свет и камеру; " +
        "внешность из библии — только чтобы не спутать персонажей, а не для копирования в промпт.\n" +
        'Верни ТОЛЬКО JSON: {"prompt":"...","negative_prompt":"...","reference_element_names":["..."],' +
        '"used_technique_ids":["..."],"params":{"aspect_ratio":"9:16","duration":15}}',
      // actionMd собирается из шотов группы — при наличии beats не дублируем его
      user:
        (beatsBlock
          ? `Группа (${shot.durationSec} сек).\n${beatsBlock}\n`
          : `Действие группы (${shot.durationSec} сек): ${shot.actionMd}\n`) +
        (shot.cameraHint ? `Подсказка по камере: ${shot.cameraHint}\n` : "") +
        (shot.title ? `Название: ${shot.title}` : ""),
    },
    shotPromptSchema,
  ).then(enforceTemplateInvariants);
}

/** M3 — правка промпта: замечание → версия N+1 (JSON) */
export async function llmRevisePrompt(
  promptId: string,
  feedback: string,
  failureReason?: string,
): Promise<ShotPrompt> {
  const db = await getDb();
  const [prev] = await db.select().from(prompts).where(eq(prompts.id, promptId));
  if (!prev) throw new Error("Промпт не найден");
  const [shot] = await db.select().from(shots).where(eq(shots.id, prev.shotId));
  const settings = await getAllSettings();
  const { rules, model } = await seriesSystemBase();
  const knowledge = await knowledgeContext(prev.targetModel);
  // ревизия наследует шаблон семейства исходной версии (Seedance или Kling)
  const isKlingRev = promptFamily(prev.targetModel) === "kling";
  const reviseTemplate = isKlingRev ? settings.tpl_video_kling : settings.tpl_video;
  // стартовый кадр: как и в llmShotPrompt — упоминать только если реально прикреплён
  const reviseShotRefs = shot
    ? await db.select().from(references).where(eq(references.shotId, shot.id))
    : [];
  const reviseAnchor = isKlingRev ? "@Start" : "@Image1";
  const reviseStartBlock = reviseShotRefs.some((r) => r.role === "start_frame")
    ? `СТАРТОВЫЙ КАДР: прикреплён — ссылка на него ровно одной строкой "Use ${reviseAnchor} as the locked starting frame.".`
    : `СТАРТОВЫЙ КАДР: НЕ прикреплён — убери/не добавляй упоминания ${reviseAnchor}, @Start, @Image1 и "starting frame".`;
  return runJson(
    {
      kind: "revision",
      model,
      episodeId: shot?.episodeId,
      maxTokens: 8000,
      system:
        `${reviseTemplate}\n\n${rules}\n\n${reviseStartBlock}\n\n${knowledge}\n\n` +
        `Улучши промпт для модели ${prev.targetModel} с учётом замечания, следуя шаблону выше и ` +
        "сохранив работающие части. Промпт на английском, не длиннее 3500 символов, без " +
        "дублирующихся правил и тавтологичных identity-строк (одна на персонажа).\n" +
        'Верни ТОЛЬКО JSON: {"prompt":"...","negative_prompt":"...","reference_element_names":["..."],' +
        '"used_technique_ids":[],"params":{"aspect_ratio":"9:16","duration":15}}',
      user:
        `Текущий промпт (v${prev.version}):\n${prev.text}\n\n` +
        (prev.negativePrompt ? `Negative: ${prev.negativePrompt}\n\n` : "") +
        `Замечание пользователя: ${feedback}` +
        (failureReason ? `\n\nПричина отказа генерации: ${failureReason}` : ""),
    },
    shotPromptSchema,
  ).then(enforceTemplateInvariants);
}

/**
 * Кнопка «Анализ» в библии: vision-модель описывает референс персонажа. Весь
 * результат ТОЛЬКО на английском и переводит ВСЕ текстовые поля сущности — имя,
 * описание, гардероб и подписи всех референсов (на любом языке) сливаются с тем,
 * что видно на картинке, и приводятся к английскому. Крупные фото ужимаются на
 * лету (см. toVisionImageData), чтобы не упереться в лимит vision-модели.
 * Модель — «для простых запросов» из настроек; если она не видит картинки
 * (DeepSeek) — самая дешёвая vision-модель (Haiku 4.5).
 *
 * captions в ответе — переводы существующих подписей референсов в том же порядке,
 * что и captionInputs (заполняет вызывающий код через второй аргумент).
 */
export async function llmAnalyzeCharacterRef(
  refId: string,
  captionInputs: string[] = [],
): Promise<ImageAnalysis> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) throw new Error("Референс не найден");
  const [entity] = ref.entityId
    ? await db.select().from(entities).where(eq(entities.id, ref.entityId))
    : [];
  const raw = await readFile(ref.storagePath);
  const { toVisionImageData } = await import("@/lib/image");
  const { base64, mediaType } = await toVisionImageData(raw, ref.storagePath);
  const settings = await getAllSettings();
  const model = visionModelFrom(settings.llm_simple_model);

  // уже заполненные текстовые поля (на любом языке) — модель переведёт и учтёт
  const existingName = entity?.name?.trim() ?? "";
  const existingDescription = entity?.description?.trim() ?? "";
  const existingWardrobe = entity?.wardrobe?.trim() ?? "";
  const existingLines = [
    existingName ? `- current name: ${existingName}` : "",
    existingDescription ? `- current description: ${existingDescription}` : "",
    existingWardrobe ? `- current wardrobe: ${existingWardrobe}` : "",
  ].filter(Boolean);
  const existingBlock = existingLines.length
    ? "The user already filled these fields (they may be in ANY language). Translate them into " +
      "English and MERGE with what you see — keep the user's facts, route clothing wording into " +
      "wardrobe and appearance wording into description:\n" +
      existingLines.join("\n") +
      "\n"
    : "";
  // подписи всех референсов на перевод (по порядку) — вернутся в captions[]
  const captionsBlock = captionInputs.length
    ? "Also translate these existing reference captions into English. Return them in the SAME order " +
      'in the "captions" array (same length), keeping each short (2–5 words):\n' +
      captionInputs.map((c, i) => `${i + 1}. ${c}`).join("\n") +
      "\n"
    : "";

  return runJson(
    {
      kind: "analysis",
      model,
      maxTokens: 1500,
      system:
        "You are the character-bible assistant of an AI film series. Analyze the character reference " +
        "image and return ONLY one JSON object, no explanations. EVERYTHING you output MUST be in " +
        "ENGLISH, regardless of the language of the image or of any provided text. Never leave any " +
        "provided field in its original language:\n" +
        '{"name":"...","description":"...","wardrobe":"...","face_only":true,"caption":"...","captions":["..."]}\n' +
        "- name: the character's name in English/Latin — transliterate personal names (Иван→Ivan), " +
        "translate descriptive names (Старый рыбак→Old Fisherman). Keep it short. If no name was " +
        "provided and none is obvious, return an empty string.\n" +
        "- description: a SHORT visual anchor in ENGLISH — one phrase: gender, approximate age and " +
        "2–3 most characteristic traits (hair type/color, build, a distinctive feature). NOT a " +
        "paragraph — the reference itself carries the fine detail. Do NOT put clothing here.\n" +
        "- wardrobe: clothing and accessories in ENGLISH, in video-prompt format " +
        '(e.g. "charcoal wool coat over white shirt, black jeans, silver ring"). ' +
        "If clothing is essentially not visible (portrait) AND the user gave no wardrobe text — empty " +
        "string; but if the user already provided wardrobe text, always translate and keep it.\n" +
        "- face_only: true if the frame shows only the face/portrait to the shoulders and the " +
        "character's clothing cannot be anchored from this reference.\n" +
        '- caption: a short reference caption in ENGLISH, 2–5 words (e.g. "front view, dark jacket").\n' +
        '- captions: English translations of the provided reference captions, same order and length ' +
        "as given; empty array if none were provided.\n" +
        "If provided text conflicts with the image, trust the provided text for identity/clothing intent.",
      user:
        (existingBlock ? existingBlock + "\n" : "") +
        (captionsBlock ? captionsBlock + "\n" : "") +
        "Analyze this character reference and fill every field in English.",
      imageBase64: base64,
      imageMediaType: mediaType,
      refIds: [refId],
    },
    imageAnalysisSchema,
  );
}
