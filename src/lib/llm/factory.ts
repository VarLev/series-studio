/**
 * Промпт-фабрика (M3) и LLM-вызовы M2 — системные промпты собираются из:
 * правил проекта (settings) + релевантных выдержек базы знаний + библии сущностей.
 */
import { asc, eq, inArray } from "drizzle-orm";
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
import { visionModelFrom } from "./models";
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
        '"location":"локация группы","characters":["персонажи группы"],' +
        '"wardrobe":[{"name":"персонаж","outfit":"его полный наряд в этой группе, НА АНГЛИЙСКОМ"}],' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"точная реплика или пустая строка"}]}]}\n' +
        "ГАРДЕРОБ (якорь одежды): для каждой группы заполни wardrobe — конкретный наряд каждого " +
        "персонажа группы (outfit ТОЛЬКО на английском, годный для видеопромпта, например " +
        '"charcoal wool coat over white shirt, black jeans"). Одежда едина внутри группы. Между ' +
        "группами одежда меняется ТОЛЬКО при смене времени действия или обстоятельств по сюжету — " +
        "иначе повторяй наряд из предыдущей группы ДОСЛОВНО.\n" +
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
 * текущие шоты группы, фрагмент сюжета для контекста и замечание — возвращает
 * обновлённую группу тем же JSON-форматом (время шотов от 00:00).
 */
export async function llmReviseGroup(input: {
  episodeId: string;
  synopsis: string;
  groupTitle: string;
  durationSec: number;
  beats: GroupShot[];
  feedback: string;
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
  return runJson(
    {
      kind: "breakdown",
      model: input.model || model,
      episodeId: input.episodeId,
      maxTokens: 8000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты правишь ОДНУ группу шотов раскадровки вертикального сериала (группа = отдельное " +
        "AI-видео не длиннее 15 секунд). Перепиши группу с учётом замечания пользователя, " +
        "сохранив рабочие части и не выходя за события сюжета.\n" +
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n` +
        "Верни ТОЛЬКО JSON без пояснений:\n" +
        '{"title":"название группы","duration_sec":14,' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"точная реплика или пустая строка"}]}\n' +
        "Время шотов отсчитывается от начала группы (первый шот с 00:00).",
      user:
        `Фрагмент сюжета эпизода (контекст):\n${input.synopsis}\n\n` +
        `Текущая группа:\n${current}\n\n` +
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
  const isKling = targetModel.toLowerCase().includes("kling");

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
  const outfitByEntity = new Map(links.map((l) => [l.entityId, l.outfit]));
  const outfits = characterRows
    .map((e) => ({ e, outfit: (outfitByEntity.get(e.id) || e.wardrobe).trim() }))
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
  const wardrobeBlock =
    outfits.length || faceOnly.length
      ? "ГАРДЕРОБ ГРУППЫ (жёсткий якорь одежды):\n" +
        [
          ...outfits.map((x) => `- ${x.e.name} (${x.e.elementName}): ${x.outfit}`),
          ...faceOnly.map(
            (c) =>
              `- Референс ${c.elementName} — ТОЛЬКО ЛИЦО: в промпте явно укажи ` +
              `"Use ${c.elementName} reference for face and identity only; clothing per wardrobe lock".`,
          ),
        ].join("\n") +
        "\nПравила гардероба: включи в текст промпта блок WARDROBE LOCK с этой одеждой " +
        "(дословно, на английском) и правилом «clothing must remain identical in every shot»; " +
        "не выдумывай и не меняй предметы одежды ни в одном шоте группы."
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

  return runJson(
    {
      kind: "prompt",
      model,
      episodeId: shot.episodeId,
      maxTokens: 8000,
      // шаблон видео-промпта заказчика (настройки) — основа системной инструкции
      system:
        `${settings.tpl_video}\n\n${rules}\n\n${bible}\n\n${wardrobeBlock}\n\n${knowledge}\n\n${techniquesBlock}\n\n` +
        `Составь промпт для модели ${targetModel} на английском языке, СТРОГО следуя структуре ` +
        "видео-промпта из шаблона выше (для простой сцены без диалога допустим короткий шаблон). " +
        "Обязательно включи в текст промпта: Format: vertical 9:16; Duration; No subtitles. No text overlays; " +
        "блоки Scene/Action/Performance/Camera/Audio/Strict rules; если есть реплика — DIALOGUE LOCK с точным текстом. " +
        (isKling
          ? "Для Kling промпт начинается с описания камеры/ракурса (движение камеры — первым предложением). "
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
  return runJson(
    {
      kind: "revision",
      model,
      episodeId: shot?.episodeId,
      maxTokens: 8000,
      system:
        `${settings.tpl_video}\n\n${rules}\n\n${knowledge}\n\n` +
        `Улучши промпт для модели ${prev.targetModel} с учётом замечания, следуя шаблону выше и ` +
        "сохранив работающие части. Промпт на английском.\n" +
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

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Кнопка «Анализ» в библии: vision-модель описывает референс персонажа —
 * внешность (RU), гардероб (EN, уходит в промпты как есть), флаг «только лицо».
 * Модель — «для простых запросов» из настроек; если она не видит картинки
 * (DeepSeek) — самая дешёвая vision-модель (Haiku 4.5).
 */
export async function llmAnalyzeCharacterRef(refId: string): Promise<ImageAnalysis> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) throw new Error("Референс не найден");
  const data = await readFile(ref.storagePath);
  if (data.length > 4_500_000) {
    throw new Error("Файл референса больше 4.5 МБ — vision-модель его не примет");
  }
  const ext = ref.storagePath.slice(ref.storagePath.lastIndexOf(".")).toLowerCase();
  const settings = await getAllSettings();
  const model = visionModelFrom(settings.llm_simple_model);
  return runJson(
    {
      kind: "analysis",
      model,
      maxTokens: 1500,
      system:
        "Ты — ассистент библии персонажей AI-сериала. Проанализируй референс-изображение " +
        "персонажа и верни ТОЛЬКО один JSON-объект без пояснений:\n" +
        '{"description":"...","wardrobe":"...","face_only":true,"caption":"..."}\n' +
        "- description: КОРОТКИЙ визуальный якорь НА РУССКОМ — одна фраза: пол, примерный возраст и " +
        "2–3 самые характерные приметы (тип/цвет волос, телосложение, особая черта). НЕ абзац, " +
        "детали облика задаёт сам референс. Одежду сюда НЕ включай.\n" +
        "- wardrobe: одежда и аксессуары НА АНГЛИЙСКОМ, в формате видеопромпта " +
        '(например "charcoal wool coat over white shirt, black jeans, silver ring"). ' +
        "Если одежды практически не видно (портрет) — пустая строка.\n" +
        "- face_only: true, если в кадре только лицо/портрет по плечи и одежду персонажа " +
        "по этому референсу зафиксировать нельзя.\n" +
        "- caption: короткая подпись референса на русском, 2–5 слов (например «анфас, тёмная куртка»).",
      user: "Проанализируй этот референс персонажа.",
      imageBase64: data.toString("base64"),
      imageMediaType: IMAGE_MIME[ext] ?? "image/png",
    },
    imageAnalysisSchema,
  );
}
