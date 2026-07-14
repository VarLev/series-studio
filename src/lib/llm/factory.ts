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
import { chainLocation, chainTimeWeather, parseTimeRange } from "@/lib/beats";
import { refAnalysisText } from "@/lib/refAnalysis";
import { startFrameLine, compositionLine, layoutLine } from "@/lib/refDirectives";
import { TIMING_RULES, LANGUAGE_RULES, DIALOGUE_RULES } from "@/lib/templates";
import { listTechniques, techniqueIndex, getTechniquesByIds } from "@/lib/director";
import { effectiveOutfit } from "@/lib/wardrobe";
import { promptFamily, visionModelFrom } from "./models";
import { runJson } from "./client";
import {
  breakdownSchema,
  enhanceGroupSchema,
  groupPatchSchema,
  imageAnalysisSchema,
  insertGroupsSchema,
  referenceAnalysisSchema,
  shotPromptSchema,
  type Breakdown,
  type EnhanceGroup,
  type GroupPatch,
  type GroupShot,
  type ImageAnalysis,
  type InsertGroups,
  type ReferenceAnalysis,
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
        '"location":"локация группы","time_weather":"время суток и погода, напр. night, rain","emotional_tone":"эмоциональный тон группы на английском, напр. calm / tense, ominous / tender","scene_start":true,"characters":["персонажи группы"],' +
        '"wardrobe":[{"name":"персонаж","outfit":"наряд ТОЛЬКО если сюжет его описал для этой сцены, иначе пустая строка, НА АНГЛИЙСКОМ"}],' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"реплики в формате [Имя]: -фраза, каждая реплика с новой строки; либо пустая строка"}]}]}\n' +
        "СЦЕНЫ (границы сюжетных сцен): scene_start: true — если группа начинает НОВУЮ сюжетную " +
        "сцену: смена локации, скачок во времени или разрыв непрерывности действия. Если группа — " +
        "прямое продолжение предыдущей (та же обстановка, действие течёт без разрыва) — scene_start: false. " +
        "Первая группа эпизода — всегда scene_start: true.\n" +
        "ВРЕМЯ СУТОК И ПОГОДА: для каждой группы заполни time_weather по сюжету — время суток и " +
        "погода (напр. «evening, overcast», «night, rain», «bright sunny day»). Внутри одной сцены " +
        "(scene_start: false) — ОДИНАКОВО во всех группах; менять можно только на границе сцены " +
        "(scene_start: true). Если сюжет не уточняет — выбери правдоподобное и держи единым по сцене.\n" +
        "ЭМОЦИОНАЛЬНЫЙ ТОН: для КАЖДОЙ группы заполни emotional_tone (на английском, 1–3 слова) — " +
        "настроение и атмосфера ИМЕННО этого фрагмента по тому, что в нём реально происходит: " +
        "напр. «calm», «tender», «tense», «anxious, ominous», «warm», «melancholic», «angry». " +
        "Определяй его по СОДЕРЖАНИЮ группы, а не по общему тону сериала: если в группе ничего " +
        "напряжённого не происходит — ставь спокойный/нейтральный тон (calm), НЕ нагнетай тревогу. " +
        "Тон может свободно меняться от группы к группе даже внутри одной сцены.\n" +
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
        // программно, поверх редактируемого шаблона задания (tpl_breakdown) — так
        // точная формула тайминга не зависит от того, что пользователь оставил в шаблоне
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n${DIALOGUE_RULES}`,
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
/**
 * Контекст референсов группы для Enhance/Rework: что на прикреплённых картинках
 * (анализ vision-модели) + как это применять по роли. Пусто, если у шота нет
 * референсов с анализом. Анализ бэкофиллит вызывающий код (ensureShotRefsAnalyzed).
 */
async function shotRefsContext(shotId: string): Promise<string> {
  const db = await getDb();
  const rows = (
    await db.select().from(references).where(eq(references.shotId, shotId))
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lines = rows
    .map((r) => {
      const a = refAnalysisText(r.analysis);
      if (!a) return "";
      const label =
        r.role === "start_frame" ? "стартовый кадр" : r.role === "layout" ? "layout" : "композиция";
      return `- [${label}] ${a}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return (
    "РЕФЕРЕНСЫ ГРУППЫ (что на прикреплённых картинках — учитывай их в полях «план и ракурс» и " +
    "«что видит камера»):\n" +
    lines.join("\n") +
    "\nКак применять: стартовый кадр — ПЕРВЫЙ основной шот строго соответствует ему (композиция, " +
    "ракурс, расстановка, свет), действие продолжается ИЗ него; layout — бери геометрию помещения и " +
    "взаимное расположение персонажей/объектов, но ракурс выбирай свой; композиция — ориентир по " +
    "кадрированию, свету и настроению."
  );
}

export async function llmReviseGroup(input: {
  episodeId: string;
  /** id группы — чтобы подтянуть контекст её референсов (start-frame/composition/layout) */
  shotId: string;
  /** краткий контекст: что в соседних группах (НЕ весь сюжет эпизода) */
  contextFragment: string;
  groupTitle: string;
  durationSec: number;
  beats: GroupShot[];
  feedback: string;
  targetOrders?: number[];
}): Promise<GroupPatch> {
  const { rules } = await seriesSystemBase();
  const bible = await bibleContext(undefined, { mode: "names" });
  const refCtx = await shotRefsContext(input.shotId);
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
      "В ответе верни В МАССИВЕ shots ТОЛЬКО эти шоты (с их прежними order) — остальные шоты группы " +
      "НЕ включай в JSON: приложение оставит их без изменений само. Количество и порядок целевых " +
      "шотов сохрани (не дели, не добавляй и не удаляй их). Так ответ короче и генерится быстрее.\n"
    : "ОБЛАСТЬ ПРАВКИ: состав шотов определяет ЗАПРОС — создавай, удаляй, разбивай, объединяй и " +
      "редактируй шоты так, как он требует. «Разбей шот на 2» — логически раздели содержимое " +
      "существующего шота на два (действие и реплики распредели по ходу сюжета, планы — по запросу, " +
      "напр. сначала общий, потом средний). «Собери шоты по сюжету» — пересобери состав шотов группы " +
      "заново по её сюжетной сцене. Шоты, которых запрос не касается, верни без изменений.\n";
  return runJson(
    {
      kind: "breakdown",
      // Rework всегда через Claude по подписке (CLI): дешёвые сторонние модели
      // нестабильны (реальный инцидент — 503 от модели простых запросов)
      model: "claude-sonnet-4-6",
      forceCli: true,
      // реворд — механическая правка (перераспределить реплики, пересчитать тайминг):
      // режем «мышление» CLI, иначе вызов тонет на ~12k токенов рассуждения и 170–210с
      // (проверено: с бюджетом 0 тот же реворк — ~12с). См. thinkingTokens в LlmCall.
      thinkingTokens: 0,
      episodeId: input.episodeId,
      maxTokens: 8000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты правишь ОДНУ группу шотов раскадровки вертикального сериала (группа = отдельное " +
        "AI-видео не длиннее 15 секунд). Перепиши её шоты по запросу пользователя, сохранив " +
        "сюжет группы и рабочие части.\n" +
        "ТЕКУЩЕЕ содержимое шотов (реплики, действие, планы) — ИСТОЧНИК ИСТИНЫ и приоритет. Работай " +
        "именно с ним: существующие реплики и действие сохраняй ДОСЛОВНО, лишь распределяя, " +
        "перегруппировывая или деля их по запросу. НЕ заменяй текущий текст «изначальным» или " +
        "сюжетным вариантом и НЕ переписывай реплики, если запрос явно этого не требует. При разбиении " +
        "шота его текущие реплики и действие раздели между новыми шотами, ничего не выдумывая заново.\n" +
        scope +
        "РАБОТАЙ ТОЛЬКО С ШОТАМИ. НЕ заполняй и НЕ меняй локацию, время суток, погоду, " +
        "эмоциональный тон, референсы и привязки сущностей — их нет в твоём ответе, и не вписывай " +
        "их описания в текст шотов без необходимости. Мизансцена: собеседников в очной сцене держи " +
        "в связке (не уводи одного в дальний расфокусированный фон, пока другой к нему обращается).\n" +
        "ПЕРЕСЧИТАЙ ТАЙМИНГ: у каждого шота честное время по правилам хронометража ниже; шоты идут " +
        "встык от 00:00; duration_sec группы = сумма шотов, НЕ БОЛЬШЕ 15 секунд.\n" +
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n${DIALOGUE_RULES}\n` +
        (refCtx ? refCtx + "\n" : "") +
        "Верни ТОЛЬКО JSON без пояснений " +
        (input.targetOrders?.length
          ? `(в массиве shots — ТОЛЬКО изменённые шоты [${input.targetOrders.join(", ")}], без остальных):\n`
          : "(ВСЕ шоты группы, включая неизменённые):\n") +
        '{"title":"название группы","duration_sec":14,' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"реплики в формате [Имя]: -фраза, каждая реплика с новой строки; либо пустая строка"}]}\n' +
        // Sonnet через CLI при точечной правке склонен отдать голый массив шотов
        // вместо объекта — это валило валидацию и запускало дорогой ретрай. Требуем
        // объект явно (плюс схема groupPatchSchema теперь принимает и голый массив).
        "ОТВЕТ — РОВНО ОДИН JSON-ОБЪЕКТ с ключами title, duration_sec и shots. НЕ отдавай " +
        "голый массив шотов [ {…}, {…} ] и НЕ оборачивай ответ в ```-блоки.\n" +
        "Время шотов отсчитывается от начала группы (первый шот с 00:00).",
      user:
        (input.contextFragment.trim()
          ? `Сюжетный контекст соседних групп (НЕ переписывай их, только для связности):\n${input.contextFragment}\n\n`
          : "") +
        `Текущая группа (правишь только её основные шоты):\n${current}\n\n` +
        `Запрос пользователя: ${input.feedback}`,
    },
    groupPatchSchema,
  );
}

/**
 * Вставные группы (спин-офф сцены): по запросу пользователя и краткому контексту
 * сцены модель создаёт 1..N НОВЫХ групп шотов (каждая ≤15 сек — отдельное
 * AI-видео). Вставки живут внутри сцены, но со своими локацией/временем/погодой
 * и своей шкалой времени — существующие группы и сквозной таймкод не трогают.
 */
export async function llmInsertGroups(input: {
  episodeId: string;
  /** краткий контекст сцены: локация/время + содержание её групп (НЕ весь сюжет) */
  sceneContext: string;
  /** запрос пользователя: что должно происходить в новых шотах */
  request: string;
  model?: string;
}): Promise<InsertGroups> {
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext(undefined, { mode: "names" });
  return runJson(
    {
      kind: "breakdown",
      model: input.model || model,
      episodeId: input.episodeId,
      maxTokens: 16000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты добавляешь ВСТАВНЫЕ группы шотов к существующей сцене вертикального сериала " +
        "(группа = отдельное AI-видео не длиннее 15 секунд). Пользователь описал, что должно " +
        "происходить в новых шотах; контекст сцены дан ТОЛЬКО для связности (персонажи, тон, " +
        "обстановка) — существующие группы НЕ переписывай и НЕ пересказывай.\n" +
        "Сам реши, сколько групп создать — одну или несколько: считай по правилам хронометража " +
        "ниже (реплики и действия по формуле не помещаются в 15 секунд одной группы — значит нужна " +
        "ещё одна группа), а не по интуиции. У вставки могут быть СВОИ локация и время/погода: если " +
        "запрос переносит действие в другое место или время — задай новые значения; если нет — " +
        "повтори значения сцены.\n" +
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n${DIALOGUE_RULES}\n` +
        "У каждой группы заполни emotional_tone (на английском, 1–3 слова) по тому, что в ней " +
        "происходит по запросу: calm / tense / tender / anxious, ominous / warm — не нагнетай " +
        "тревогу, если фрагмент спокойный.\n" +
        "Верни ТОЛЬКО JSON без пояснений:\n" +
        '{"groups":[{"order":1,"title":"название группы","duration_sec":14,' +
        '"location":"локация группы","time_weather":"время суток и погода, напр. night, rain",' +
        '"emotional_tone":"эмоциональный тон группы, напр. calm / tense, ominous",' +
        '"characters":["персонажи группы"],' +
        '"wardrobe":[{"name":"персонаж","outfit":"наряд ТОЛЬКО если запрос или сцена его описали, иначе пустая строка, НА АНГЛИЙСКОМ"}],' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"реплики в формате [Имя]: -фраза, каждая реплика с новой строки; либо пустая строка"}]}]}\n' +
        "Время шотов отсчитывается ОТ НАЧАЛА ГРУППЫ: первый шот каждой группы — с 00:00.",
      user:
        `Контекст сцены (для связности, НЕ переписывать):\n${input.sceneContext}\n\n` +
        `Запрос пользователя — что должно быть в новых шотах:\n${input.request}`,
    },
    insertGroupsSchema,
  );
}

/**
 * Enhance: Opus переоценивает ОДНУ группу целиком (всегда через CLI/подписку) —
 * возвращает улучшенные шоты с таймингом, закреплённый за каждым шотом приём,
 * уточнённые локацию/погоду/тон и список персонажей реально в кадре. Заменяет
 * прежний автоподбор приёмов на этапе генерации промпта (перенесён сюда).
 */
export async function llmEnhanceGroup(input: {
  episodeId: string;
  /** id группы — чтобы подтянуть контекст её референсов (start-frame/composition/layout) */
  shotId: string;
  groupTitle: string;
  durationSec: number;
  beats: GroupShot[];
  location: string;
  timeWeather: string;
  emotionalTone: string;
  /** краткий контекст соседних групп (НЕ весь сюжет) — для связности */
  sceneContext: string;
}): Promise<EnhanceGroup> {
  const { rules } = await seriesSystemBase();
  const bible = await bibleContext(undefined, { mode: "names" });
  const refCtx = await shotRefsContext(input.shotId);
  const all = await listTechniques();
  const techIndexBlock = all.length
    ? "БИБЛИОТЕКА РЕЖИССЁРСКИХ ПРИЁМОВ (id | название | камера | теги | категория) — " +
      "для каждого шота выбери НЕ БОЛЕЕ ОДНОГО приёма (technique_id), только если он ПОДХОДИТ к сути " +
      "именно этого шота и усиливает его; иначе technique_id: \"\". Подбирай по содержанию шота: сколько " +
      "персонажей реально в кадре, что за действие, крупность. Приём, которому нужен второй персонаж " +
      "(over-the-shoulder, shot/reverse, two-shot, диалоговая пара), НЕ вешай на одиночный шот с одним " +
      "человеком. Приём задаёт язык камеры/подачи, но НЕ переопределяет мизансцену шота (место, кто в " +
      "кадре, кто где стоит) — если приём тянет чужой блокинг, он не подходит:\n" +
      techniqueIndex(all) +
      "\n\n"
    : "";
  const fmtBeat = (b: GroupShot): string =>
    `Шот ${b.order} (${b.time}): План/ракурс: ${b.framing}. Камера: ${b.camera}. ` +
    `Действие: ${b.action}.${b.dialogue ? ` Реплика: «${b.dialogue}»` : ""}` +
    `${b.technique_id ? ` [закреплён приём: ${b.technique_id}]` : ""}`;
  // Enhance работает ТОЛЬКО с основными шотами (Main); черновики (Draft) сюда не
  // приходят и не трогаются вовсе (замечание заказчика)
  const mainNow = input.beats.filter((b) => !b.draft);
  const current = `ТЕКУЩИЕ шоты группы (Main):\n${mainNow.map(fmtBeat).join("\n") || "(пусто)"}`;
  return runJson(
    {
      kind: "breakdown",
      model: "claude-opus-4-8", // Enhance всегда на Opus
      forceCli: true, // и всегда через подписку (CLI)
      episodeId: input.episodeId,
      maxTokens: 12000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты — старший режиссёр вертикального сериала. Тебе дают ТЕКУЩИЕ основные шоты одной группы. " +
        "Твоя задача — УЛУЧШИТЬ их, а НЕ пересобрать заново.\n" +
        "ГЛАВНОЕ ПРАВИЛО: сюжет, действие и реплики, которые УЖЕ есть в шотах — ИСТОЧНИК ИСТИНЫ. НЕ " +
        "придумывай новый сюжет и НЕ пересобирай сцену «с нуля» по исходной истории. Работай ровно с тем, " +
        "что уже есть: сохраняй смысл, ход действия и реплики каждого шота, лишь шлифуя формулировки, " +
        "ракурс, камеру и дозаполняя пустые поля. Существующие реплики сохраняй ДОСЛОВНО (допустимо " +
        "поправить оформление/пунктуацию и формат «[Имя]: -фраза»); действие оставляй тем же по сути, " +
        "делая его точнее и кинематографичнее.\n" +
        "Что МОЖНО делать:\n" +
        "- дозаполнять и уточнять поля framing (план/ракурс), camera (что видит камера), а также " +
        "location, time_weather, emotional_tone по содержанию группы;\n" +
        "- РАЗБИТЬ шот на два, если его действие/реплики не помещаются в отведённое время — распредели " +
        "СУЩЕСТВУЮЩЕЕ содержимое между двумя шотами, ничего не выдумывая; можно объединить два соседних " +
        "шота, если это не теряет содержания;\n" +
        "- уточнить тайминг каждого шота по формуле хронометража ниже;\n" +
        "- закрепить за шотом не более ОДНОГО подходящего режиссёрского приёма;\n" +
        "- в characters_in_frame перечислить element_name ТОЛЬКО тех персонажей библии, кто РЕАЛЬНО в " +
        "кадре (по действию и репликам) — не всех упомянутых.\n" +
        "Чего делать НЕЛЬЗЯ:\n" +
        "- выбрасывать, подменять или переписывать существующее действие/реплики; менять ход сюжета " +
        "группы; добавлять новые сюжетные события, которых в шотах не было;\n" +
        "- НИЧЕГО не уноси в черновики: черновиков в этой задаче НЕТ, все шоты остаются основными " +
        "(draft: false). Если материал не влезает в 15 секунд — не сжимай его в кашу и не выкидывай, а " +
        "раздели на большее число ОСНОВНЫХ шотов (тайминг посчитай честно). Лимит 15 сек здесь — " +
        "ориентир; приоритет — сохранить существующее содержание.\n" +
        "МИЗАНСЦЕНА каждого шота (поля framing и camera): если в шоте двое в прямом разговоре или очной " +
        "сцене — держи их В СВЯЗКЕ (плотный two-shot, over-the-shoulder или чередование крупных планов " +
        "лицом к лицу). НЕ ставь одного собеседника в дальний/расфокусированный фон, пока другой к нему " +
        "обращается. Дальний план оправдан ТОЛЬКО если по действию они реально разошлись. По умолчанию " +
        "собеседник — близко и в фокусе. Прежнюю неудачную расстановку не тяни по инерции — переоцени по " +
        "сути сцены, но саму сцену (сюжет, действие, реплики) не меняй.\n" +
        `${TIMING_RULES}\n${LANGUAGE_RULES}\n${DIALOGUE_RULES}\n` +
        (refCtx ? refCtx + "\n" : "") +
        "\n" +
        techIndexBlock +
        "Верни ТОЛЬКО JSON без пояснений (ВСЕ шоты — основные, draft:false):\n" +
        '{"title":"название группы","duration_sec":14,"location":"локация","time_weather":"время суток и погода",' +
        '"emotional_tone":"эмоциональный тон, напр. calm / tense","characters_in_frame":["@Simon"],' +
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"реплики в формате [Имя]: -фраза, каждая реплика с новой строки; либо пустая строка","technique_id":"b19 или пусто",' +
        '"draft":false}]}\n' +
        "Все шоты в массиве shots — основные (draft:false). НЕ создавай ключей shots_draft/draft_shots/drafts " +
        "и НЕ помечай шоты draft:true.\n" +
        "Время шотов отсчитывается от начала группы (первый шот — с 00:00).",
      user:
        (input.sceneContext.trim()
          ? `Контекст соседних групп (для связности, НЕ переписывай их):\n${input.sceneContext}\n\n`
          : "") +
        `Группа «${input.groupTitle}» (${input.durationSec} сек). ` +
        `Текущие: локация "${input.location}", время/погода "${input.timeWeather}", тон "${input.emotionalTone}".\n` +
        current,
    },
    enhanceGroupSchema,
  );
}

/**
 * Инварианты шаблона (предпочтения §7): vertical 9:16 и запрет субтитров
 * должны быть в каждом видео-промпте — гарантируем программно, а не надеждой на LLM.
 */
function enforceTemplateInvariants(res: ShotPrompt): ShotPrompt {
  // срезаем заголовок-метку шаблона, если модель начала промпт с него
  // («SEEDANCE 2.0 PROMPT», «KLING 3.0 OMNI PROMPT» и т.п.)
  res.prompt = res.prompt.replace(/^\s*(?:SEEDANCE|KLING)[^\n]*PROMPT\s*\n+/i, "").trimStart();
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
  /** order одного бита группы — промпт только для этого шота (переген одного шота) */
  singleBeatOrder?: number,
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

  // ---------- локация из библии (референс окружения) ----------
  // привязанная к группе location-сущность С референсом → её фото прикрепляется
  // к задаче (identityRefs берёт всё из reference_element_names), а промпт обязан
  // содержать строку-референс окружения с element_name локации
  const locationRows = linkedEntities.filter((e) => e.type === "location");
  const locEntityRefs = locationRows.length
    ? await db
        .select({ entityId: references.entityId })
        .from(references)
        .where(inArray(references.entityId, locationRows.map((l) => l.id)))
    : [];
  const refLocations = locationRows.filter((l) =>
    locEntityRefs.some((r) => r.entityId === l.id),
  );
  const locationRefBlock = refLocations.length
    ? "ЛОКАЦИЯ-РЕФЕРЕНС ИЗ БИБЛИИ: к группе привязана локация с приложенным фото-референсом — " +
      refLocations.map((l) => `${l.name} (element_name: "${l.elementName}")`).join(", ") +
      ". Её облик (архитектура, планировка, мебель, материалы) несёт референс, НЕ выдумывай другой " +
      "интерьер/экстерьер и не расписывай обстановку подробно. Рядом с identity-строками персонажей " +
      "добавь ровно ОДНУ строку на локацию: " +
      refLocations
        .map((l) => `"Use ${l.elementName} as the location and environment reference."`)
        .join(" ") +
      " В тексте промпта ссылайся на эту локацию её element_name (" +
      refLocations.map((l) => l.elementName).join(", ") +
      ") — как с персонажами. ОБЯЗАТЕЛЬНО включи " +
      refLocations.map((l) => l.elementName).join(", ") +
      " в reference_element_names — иначе референс не прикрепится к задаче."
    : "";

  // ---------- стартовый кадр: упоминается в промпте ТОЛЬКО если реально прикреплён ----------
  // (инцидент: шаблон показывает строку "Use @Image1 …" в примере структуры, и модель
  // писала её даже без прикреплённого кадра)
  const shotRefs = await db.select().from(references).where(eq(references.shotId, shotId));
  const hasStartFrame = shotRefs.some((r) => r.role === "start_frame");
  const startRef = shotRefs.find((r) => r.role === "start_frame");
  const startAnalysis = refAnalysisText(startRef?.analysis);
  const startAnchor = isKling ? "@Start" : "@Image1";
  const refFamily = isKling ? "kling" : "seedance";
  const startFrameBlock = hasStartFrame
    ? `СТАРТОВЫЙ КАДР: к группе прикреплён стартовый кадр — сошлись на него ровно одной строкой ` +
      `"${startFrameLine(refFamily)}" в начале промпта и больше его не упоминай.` +
      (startAnalysis
        ? ` На стартовом кадре: ${startAnalysis}. ПЕРВЫЙ шот группы обязан ему строго соответствовать — ` +
          `та же композиция, ракурс, расстановка и свет; действие продолжается ИЗ этого кадра, не ` +
          `переигрывай его заново. Отрази это в позиции камеры и в том, что видит камера первого шота.`
        : "")
    : `СТАРТОВЫЙ КАДР: к этой группе стартовый кадр НЕ прикреплён — НЕ упоминай ${startAnchor}, ` +
      `@Start, @Image1 или "starting frame" вообще, даже если шаблон выше показывает такую строку в примере.`;

  // ---------- референсы шота: роль определяет строку-инструкцию ----------
  // приложение прикрепляет их к задаче и заменяет якоря @CompN на слоты картинок.
  // Порядок @Comp1..N — по createdAt (совпадает с page.tsx и generation.ts).
  //  - composition: референс задаёт кадрирование/блокинг (копируется в кадр);
  //  - layout: референс задаёт ТОЛЬКО геометрию сцены и расстановку — ракурс НЕ
  //    копируется, шоты берут свою камеру. Это как раз «привязать новое видео к
  //    прошлому по обстановке, но начать с другого ракурса», без стартового кадра.
  const attachedRefs = shotRefs
    .filter((r) => r.role !== "start_frame")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const hasLayoutRef = attachedRefs.some((r) => r.role === "layout");
  const compLines = attachedRefs.map((r, i) => {
    const anchor = `@Comp${i + 1}`;
    return `"${r.role === "layout" ? layoutLine(anchor) : compositionLine(anchor)}"`;
  });
  const compositionBlock = attachedRefs.length
    ? "РЕФЕРЕНСЫ ШОТА (приложение заменит якоря @CompN на реальные слоты картинок при отправке): " +
      "для КАЖДОГО добавь в начале промпта РОВНО ОДНУ строку ниже — дословно — и больше нигде его не упоминай:\n" +
      compLines.join("\n") +
      (hasLayoutRef
        ? "\nLayout-референс задаёт ТОЛЬКО геометрию помещения и взаимное положение персонажей/объектов: " +
          "зафиксируй их расстановку в GLOBAL CONTINUITY по сцене, но НЕ повторяй его ракурс и кадрирование — " +
          "камеру каждого шота выбирай заново."
        : "")
    : "РЕФЕРЕНСЫ ШОТА: не приложены — НЕ упоминай @Comp, \"composition reference\" или лишние @ImageN.";

  // содержимое референсов (анализ vision-модели) — что реально на каждой картинке;
  // помогает точнее описать кадр, позицию камеры и «что видит камера». В сам текст
  // промпта дословно не копируется — это контекст для модели.
  const refContentLines = attachedRefs
    .map((r, i) => {
      const a = refAnalysisText(r.analysis);
      return a ? `@Comp${i + 1} (${r.role === "layout" ? "layout" : "composition"}) — ${a}` : "";
    })
    .filter(Boolean);
  const refContentBlock = refContentLines.length
    ? "СОДЕРЖИМОЕ РЕФЕРЕНСОВ ШОТА (что на каждой картинке — используй, чтобы точнее задать позицию " +
      "камеры и что видит камера; НЕ копируй эти описания в текст промпта дословно):\n" +
      refContentLines.join("\n")
    : "";

  // ---------- сюжетная сцена: непрерывность или чистый лист ----------
  // первая группа эпизода — всегда начало сцены; иначе смотрим флаг scene_start.
  // Вставные группы (is_insert) из непрерывности исключаем: сосед-вставка — не
  // «предыдущая группа» сцены
  const [prevGroup] = await db
    .select()
    .from(shots)
    .where(
      and(
        eq(shots.episodeId, shot.episodeId),
        lt(shots.orderIndex, shot.orderIndex),
        eq(shots.isInsert, false),
      ),
    )
    .orderBy(desc(shots.orderIndex))
    .limit(1);
  // локация сцены: одна на всю сюжетную связку (до следующего scene_start) —
  // каждая группа связки получает ОДИНАКОВОЕ описание локации в промпт
  const episodeShots = await db
    .select()
    .from(shots)
    .where(eq(shots.episodeId, shot.episodeId))
    .orderBy(asc(shots.orderIndex));
  const sceneLocation = chainLocation(episodeShots, shotId);
  const locationBlock = sceneLocation
    ? `ЛОКАЦИЯ СЦЕНЫ (единая для всех групп этой сюжетной связки): "${sceneLocation}". ` +
      "Используй именно её как локацию в Scene/GLOBAL CONTINUITY (переведи на английский при " +
      "необходимости) — НЕ выдумывай другую обстановку и не меняй место действия между группами связки."
    : "";
  const sceneTimeWeather = chainTimeWeather(episodeShots, shotId);
  const timeWeatherBlock = sceneTimeWeather
    ? `ВРЕМЯ СУТОК И ПОГОДА (единые для всех групп этой сюжетной связки): "${sceneTimeWeather}". ` +
      "Отрази их в Scene/GLOBAL CONTINUITY и в описании света/неба (переведи на английский при " +
      "необходимости) — держи одинаковыми во всех группах связки, НЕ меняй время суток и погоду между группами."
    : "";
  // эмоциональный тон — СВОЙ у этой группы; задаёт эмоциональную окраску сцены и
  // ПЕРЕКРЫВАЕТ общий тон сериала (series_rules/series_style) для настроения этой
  // группы. Без него спокойная сцена наследовала «психологическое напряжение» серии.
  const emotionalTone = shot.emotionalTone.trim();
  const emotionalToneBlock = emotionalTone
    ? `ЭМОЦИОНАЛЬНЫЙ ТОН ЭТОЙ ГРУППЫ: "${emotionalTone}". Он задаёт ТОЛЬКО атмосферу и уровень ` +
      "напряжения сцены, и ТОЛЬКО в одном месте: в GLOBAL CONTINUITY зафиксируй настроение этим тоном " +
      'ОДНОЙ короткой формулировкой (напр. "calm, warm atmosphere"). НЕ создавай отдельную строку или ' +
      "блок про тон, НЕ выноси его в Performance и НЕ повторяй в каждом шоте — Performance и Action " +
      "остаются производными от действия конкретного шота, а не от тона. Остальное в GLOBAL CONTINUITY " +
      "(локация, время, свет, позиции, одежда) не меняй. Если тон спокойный/тёплый/нейтральный — " +
      'атмосфера спокойная: не добавляй тревогу, саспенс, "dark / psychological thriller / tense" ' +
      "мотивы, даже если они звучат в общих правилах или визуальном стиле сериала."
    : "";
  let sceneBlock = "";
  if (shot.isInsert) {
    sceneBlock =
      "ВСТАВНАЯ ГРУППА (спин-офф сцены): самостоятельная мини-сцена по мотивам основной. " +
      "НЕ привязывайся к моментальному действию и состоянию соседних групп — используй ТОЛЬКО " +
      "собственные локацию/время/погоду этой группы (заданы ниже) и постоянные якоря библии " +
      "(персонажи, их референсы).";
  } else if (!prevGroup || shot.sceneStart) {
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
      "погоду и одежду персонажей; действие продолжается без разрыва — состояние машины/объектов " +
      "и положение персонажей вытекает из конца предыдущей группы, без резких скачков.";
  }

  // GLOBAL CONTINUITY = только инвариант сцены (одинаков у всех связанных групп);
  // моментальное действие/движение туда НЕ пишем — оно идёт в Action шотов.
  // Мизансцена (крупность, передний/дальний план, кто в кадре) — ПО ШОТАМ, а не
  // глобальная константа: глобализация по-шотной позиции загоняла персонажа с
  // крупного плана на дальний план в другом шоте (инцидент «Craig на фоне» 2026-07-13).
  const continuityBlock =
    "GLOBAL CONTINUITY — пиши ТОЛЬКО инварианты сцены, которые ОДИНАКОВЫ во всех связанных группах " +
    "этой сюжетной связки и НЕ зависят от кадра: локация, время суток, погода/свет, одежда, что " +
    "НЕЛЬЗЯ менять (атмосферу/настроение сюда НЕ вписывай из общего тона сериала — её задаёт " +
    "эмоциональный тон группы отдельно). КАТЕГОРИЧЕСКИ НЕ пиши в GLOBAL CONTINUITY моментальное " +
    "состояние или движение — едет / тормозит / останавливается / припаркована / куда направляется / " +
    "что делает прямо сейчас: это Action конкретного шота.\n" +
    "МИЗАНСЦЕНА — ПО ШОТАМ, НЕ В GLOBAL CONTINUITY. Кто именно в кадре, крупность, кто на переднем и " +
    "кто на дальнем плане, куда смотрит — МЕНЯЕТСЯ от шота к шоту (в одном шоте крупный план одного " +
    "персонажа, в другом — средний план другого) и пишется в СВОЙ SHOT-блок. НЕ фиксируй позицию " +
    "персонажа в кадре как общую константу и НЕ пиши \"positions do not change between shots\" — иначе " +
    "персонаж, снятый крупным планом в одном шоте, ошибочно оказывается на дальнем плане в другом, а " +
    "его собеседник обращается в пустоту.\n" +
    "Позицию в GLOBAL CONTINUITY допустимо зафиксировать ТОЛЬКО если она физически неизменна во всех " +
    "кадрах — например жёсткая посадка в машине: ВЕРНО — \"interior of @Jacob's car, @Jacob at the " +
    "wheel (left), @Simon in the passenger seat (right), morning, overcast\". Если же персонажи стоят/" +
    "двигаются и каждый шот перекадрирует — единой позиции НЕТ, не выдумывай её. НЕВЕРНО (в GLOBAL " +
    "CONTINUITY): \"the car drives away\", \"@Craig stays at the trunk in the background, positions do " +
    "not change\". Поэтому у связанных групп GLOBAL CONTINUITY по смыслу СОВПАДАЕТ, различаются Action " +
    "и мизансцена шотов.";

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
  let allBeats: GroupShot[] = [];
  try {
    const parsed = JSON.parse(shot.beatsJson || "[]");
    if (Array.isArray(parsed)) allBeats = parsed as GroupShot[];
  } catch {}
  // в промпт группы идут ТОЛЬКО основные шоты (Main Shots) — черновики (draft)
  // хранят запасные варианты сцены и в Seedance-промпт не попадают
  const mainBeats = allBeats.filter((b) => !b.draft);
  // режим одного шота: промпт только для одного бита группы (дешёвый переген
  // неудачного шота вместо всей группы). По order ищем среди ВСЕХ шотов —
  // отдельное видео одного чернового шота тоже легально
  const singleBeat =
    singleBeatOrder != null ? allBeats.find((b) => b.order === singleBeatOrder) : undefined;
  const beats = singleBeat ? [singleBeat] : mainBeats;
  const singleDur = singleBeat
    ? (() => {
        const r = singleBeat.time ? parseTimeRange(singleBeat.time) : null;
        return r ? r[1] - r[0] : Math.max(2, Math.round(shot.durationSec / Math.max(1, mainBeats.length)));
      })()
    : shot.durationSec;
  const singleShotBlock = singleBeat
    ? `РЕЖИМ ОДНОГО ШОТА: собери промпт ТОЛЬКО для этого одного шота — самостоятельное короткое ` +
      `видео на ${singleDur} сек. НЕ добавляй другие шоты группы (никаких SHOT 02/03), в промпте ` +
      `ровно ОДИН SHOT. Время отсчитывай от 0.0 (Time: 0.0–${singleDur.toFixed(1)}). ` +
      `Duration: ${singleDur} seconds. Single continuous shot. Всё, что не относится к этому шоту, убери.`
    : "";
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
  // Режиссёрские приёмы больше НЕ подбираются здесь (лишний вызов на каждый шот
  // убран). Берём только те, что ЗАКРЕПЛЕНЫ за шотами группы кнопкой Enhance
  // (technique_id в beat) — их язык вплетается в соответствующий SHOT-блок.
  const attachedTechIds = [
    ...new Set(beats.map((b) => b.technique_id).filter((id): id is string => Boolean(id))),
  ];
  const candidates = await getTechniquesByIds(attachedTechIds);
  const techLabel = new Map(candidates.map((t) => [t.id, t.title]));
  // Приём даёт ТОЛЬКО грамматику камеры (движение + оптика). Свободный текст приёма
  // НЕ вливаем: его проза (жесты/реквизит/второй человек/локация — «the hands betray
  // them», «seated in a dim study», «a second figure») материализуется в кадр,
  // которого нет в сцене (инциденты b315/b217/b26). Движение+фокусное расстояние
  // материализовать в лишнее нечего. Содержание, актёрская подача и свет — из сцены.
  const techGrammar = new Map(
    candidates.map((t) => [t.id, [t.camera, t.lens].filter(Boolean).join(", ")]),
  );
  const techniquesBlock = candidates.length
    ? "РЕЖИССЁРСКИЕ ПРИЁМЫ ПО ШОТАМ — для указанного шота задай ТОЛЬКО это движение и оптику камеры " +
      "(ракурс/наезд/фокусное). Кто в кадре, действие, актёрская подача и свет берутся из СЦЕНЫ, а НЕ " +
      "из приёма — приём задаёт исключительно камеру:\n" +
      beats
        .filter((b) => b.technique_id && techGrammar.has(b.technique_id))
        .map(
          (b) =>
            `- Шот ${b.order}: ${techGrammar.get(b.technique_id) || "—"} ` +
            `(${b.technique_id} · ${techLabel.get(b.technique_id)})`,
        )
        .join("\n")
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
    "- Не добавляй декларации без визуального смысла и дублирующиеся эпитеты атмосферы в каждом блоке.\n" +
    '- НЕ начинай промпт с заголовка-метки вроде "SEEDANCE 2.0 PROMPT" или "KLING 3.0 OMNI PROMPT" — ' +
    "это название секции шаблона, а не часть промпта. Первая строка — сразу по делу.";

  // единый визуальный стиль сериала — это про КАРТИНКУ (свет/грейдинг/look), НЕ про
  // эмоцию. Вставляем ТОЛЬКО в VISUAL STYLE, ОДИН раз — не дублируем в GLOBAL
  // CONTINUITY (иначе общий «dark thriller» конфликтует со спокойным тоном группы)
  const styleBlock = settings.series_style?.trim()
    ? "ВИЗУАЛЬНЫЙ СТИЛЬ СЕРИАЛА — это про КАРТИНКУ (свет, грейдинг, реализм, цвет), НЕ про " +
      "эмоциональное настроение. Вставь его ДОСЛОВНО, СЛОВО В СЛОВО ТОЛЬКО в блок VISUAL STYLE — " +
      "РОВНО ОДИН раз; НЕ дублируй его в GLOBAL CONTINUITY, Performance или SHOT-блоки. Не " +
      "перефразируй и не меняй эпитеты от версии к версии. Эмоцию и атмосферу сцены он НЕ задаёт — " +
      `их задаёт эмоциональный тон группы (см. ниже): "${settings.series_style.trim()}".`
    : "";

  return runJson(
    {
      kind: "prompt",
      model,
      episodeId: shot.episodeId,
      maxTokens: 8000,
      // шаблон видео-промпта заказчика + правила сериала не зависят от конкретного
      // шота — кэшируемый префикс (см. cacheableSystemPrefix в client.ts), экономит
      // на каждом следующем шоте эпизода вместо повторной полной оплаты
      cacheableSystemPrefix: `${videoTemplate}\n\n${rules}`,
      system:
        `${bible}\n\n${sceneBlock}\n\n${continuityBlock}\n\n${locationBlock}\n\n${locationRefBlock}\n\n${timeWeatherBlock}\n\n${styleBlock}\n\n${emotionalToneBlock}\n\n${singleShotBlock}\n\n${startFrameBlock}\n\n${compositionBlock}\n\n${refContentBlock}\n\n${wardrobeBlock}\n\n${knowledge}\n\n${techniquesBlock}\n\n${compactBlock}\n\n` +
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
        "ИМЕНА ПЕРСОНАЖЕЙ: в тексте промпта КАЖДОЕ упоминание персонажа пиши ТОЛЬКО как его " +
        "element_name (@Simon, @Jacob) — НИКОГДА не пиши имя персонажа обычным словом (Simon, Jacob) " +
        "вне кавычек. Обычные имена собственные допустимы ИСКЛЮЧИТЕЛЬНО внутри реплик (в кавычках " +
        "DIALOGUE LOCK). В reference_element_names перечисли element_name сущностей, чьи референсы " +
        "нужно прикрепить к задаче.\n" +
        "Идентичность персонажей несут их референсы (element/image) — в тексте промпта ссылайся на " +
        "element_name и НЕ переписывай их внешность подробно. Описывай действие, эмоцию, свет и камеру; " +
        "внешность из библии — только чтобы не спутать персонажей, а не для копирования в промпт.\n" +
        'Верни ТОЛЬКО JSON: {"prompt":"...","negative_prompt":"...","reference_element_names":["..."],' +
        '"used_technique_ids":["..."],"params":{"aspect_ratio":"9:16","duration":15}}',
      // actionMd собирается из шотов группы — при наличии beats не дублируем его
      user:
        (singleBeat
          ? `ОДИН ШОТ группы (${singleDur} сек) — самостоятельное короткое видео:\n${beatsBlock}\n`
          : beatsBlock
            ? `Группа (${shot.durationSec} сек).\n${beatsBlock}\n`
            : `Действие группы (${shot.durationSec} сек): ${shot.actionMd}\n`) +
        (shot.cameraHint ? `Подсказка по камере: ${shot.cameraHint}\n` : "") +
        (shot.title ? `Название: ${shot.title}` : ""),
    },
    shotPromptSchema,
  )
    .then(enforceTemplateInvariants)
    .then((res) => {
      // приёмы для бейджей 🎥 — детерминированно из закреплённых за шотами
      // (не из ответа модели): что закреплено Enhance, то и показываем/храним
      res.used_technique_ids = attachedTechIds;
      return res;
    });
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
  const reviseStyleBlock = settings.series_style?.trim()
    ? "ВИЗУАЛЬНЫЙ СТИЛЬ СЕРИАЛА (единый, ДОСЛОВНО, не перефразируй и не меняй эпитеты между версиями): " +
      `"${settings.series_style.trim()}". Он должен остаться в VISUAL STYLE и атмосфере GLOBAL CONTINUITY без изменений.`
    : "";
  return runJson(
    {
      kind: "revision",
      model,
      episodeId: shot?.episodeId,
      maxTokens: 8000,
      cacheableSystemPrefix: `${reviseTemplate}\n\n${rules}`,
      system:
        `${reviseStartBlock}\n\n${reviseStyleBlock}\n\n${knowledge}\n\n` +
        `Улучши промпт для модели ${prev.targetModel} с учётом замечания, следуя шаблону выше и ` +
        "сохранив работающие части. Промпт на английском, не длиннее 3500 символов, без " +
        "дублирующихся правил и тавтологичных identity-строк (одна на персонажа). Имена персонажей " +
        "в тексте — ТОЛЬКО как @element_name (@Simon); обычные имена собственные допустимы лишь " +
        "внутри реплик (в кавычках).\n" +
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

/**
 * Анализ референса ШОТА (стартовый кадр / композиция / layout) vision-моделью:
 * ролонезависимое описание того, что на картинке — субъекты и их положение,
 * локация, ракурс/кадрирование, свет и настроение. Делается один раз на загрузке,
 * кэшируется за референсом (см. ensureReferenceAnalysis в lib/refs). Роль применяет
 * промпт-фабрика: стартовый кадр → первый шот строго по описанию; layout → только
 * геометрия/расстановка; композиция → кадрирование/свет/настроение.
 * Модель — «для простых запросов» (дешёвая, vision-фолбэк на Haiku).
 */
export async function llmAnalyzeShotReference(refId: string): Promise<ReferenceAnalysis> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) throw new Error("Референс не найден");
  const raw = await readFile(ref.storagePath);
  const { toVisionImageData } = await import("@/lib/image");
  const { base64, mediaType } = await toVisionImageData(raw, ref.storagePath);
  const settings = await getAllSettings();
  const model = visionModelFrom(settings.llm_simple_model);

  return runJson(
    {
      kind: "analysis",
      model,
      // ответ — 2–4 предложения (~150 токенов), но у Gemini 2.5 в max_tokens входит
      // и thinking: с бюджетом 700 модель «додумывалась» до обрыва посреди строки
      // (Unterminated string, инцидент 2026-07) — даём запас
      maxTokens: 4000,
      system:
        "You describe a visual reference for an AI film shot. Return ONLY one JSON object, no " +
        "explanations. EVERYTHING in ENGLISH regardless of anything shown in the image:\n" +
        '{"description":"...","camera":"..."}\n' +
        "- description: 2–4 sentences — WHO/WHAT is present and where they are positioned " +
        "(spatial relationships), the setting/location and key objects, plus the lighting and mood. " +
        "Be concrete and visual; this text is fed to the shot's prompt models.\n" +
        '- camera: the camera angle and framing VISIBLE in the image (e.g. "low-angle medium ' +
        'shot, subject on the left third, shallow depth of field"). If unclear, a best estimate.',
      user:
        "Describe this shot reference image: subjects and their positions, the environment, the " +
        "camera angle/framing, and the lighting/mood.",
      imageBase64: base64,
      imageMediaType: mediaType,
      refIds: [refId],
    },
    referenceAnalysisSchema,
  );
}
