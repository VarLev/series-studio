/**
 * Промпт-фабрика (M3) и LLM-вызовы M2 — системные промпты собираются из:
 * правил проекта (settings) + релевантных выдержек базы знаний + библии сущностей.
 */
import { eq, inArray } from "drizzle-orm";
import {
  getDb,
  entities,
  knowledgeDocs,
  prompts,
  shots,
  shotEntities,
} from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { TIMING_RULES } from "@/lib/templates";
import { listTechniques, techniqueIndex, getTechniquesByIds } from "@/lib/director";
import { runJson } from "./client";
import {
  breakdownSchema,
  groupPatchSchema,
  shotPromptSchema,
  techniquePickSchema,
  type Breakdown,
  type GroupPatch,
  type GroupShot,
  type ShotPrompt,
} from "./contracts";

async function seriesSystemBase(): Promise<{ rules: string; model: string }> {
  const s = await getAllSettings();
  return {
    rules: `Сериал «${s.series_title}». Правила сериала:\n${s.series_rules}`,
    model: s.llm_model,
  };
}

async function bibleContext(entityIds?: string[]): Promise<string> {
  const db = await getDb();
  const rows = entityIds?.length
    ? await db.select().from(entities).where(inArray(entities.id, entityIds))
    : await db.select().from(entities).where(eq(entities.archived, false));
  if (!rows.length) return "Библия сущностей пока пуста.";
  return (
    "Библия сериала (element_name — канонические имена для промптов):\n" +
    rows
      .map((e) => `- [${e.type}] ${e.name} (element_name: "${e.elementName}"): ${e.description}`)
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
): Promise<Breakdown> {
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext();
  const settings = await getAllSettings();
  const user = settings.tpl_breakdown
    .replaceAll("{{STORY}}", synopsis)
    .replaceAll("[ВСТАВИТЬ ТЕКСТ]", synopsis);
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
        '"shots":[{"order":1,"time":"00:00–00:05","framing":"план и ракурс","camera":"что видит камера",' +
        '"action":"действие и эмоция","dialogue":"точная реплика или пустая строка"}]}]}\n' +
        "Соответствие формату задания: группа = «# ГРУППА NN» (не длиннее 15 секунд, пригодна для " +
        "отдельной AI-видеогенерации), shots = «### Шот N» внутри группы, duration_sec — длительность " +
        "группы в секундах. Время шотов (shots[].time) отсчитывается ОТ НАЧАЛА ГРУППЫ: первый шот " +
        "каждой группы начинается с 00:00. Время группы (time) — сквозное по эпизоду. " +
        "Все правила задания (хронометраж, реплики, планы) действуют.\n" +
        "Если персонаж или локация совпадает с сущностью из библии выше — пиши в characters/location " +
        "ТОЧНОЕ имя (name) этой сущности, чтобы приложение связало их автоматически.",
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
  const bible = await bibleContext();
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
        `${TIMING_RULES}\n` +
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
): Promise<string[]> {
  const all = await listTechniques();
  if (!all.length) return [];
  try {
    const res = await runJson(
      {
        kind: "prompt",
        model: "claude-haiku-4-5",
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

/** M3 — сгенерировать промпт для шота под целевую модель (JSON) */
export async function llmShotPrompt(shotId: string, targetModel: string): Promise<ShotPrompt> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) throw new Error("Шот не найден");
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const settings = await getAllSettings();
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext(links.map((l) => l.entityId));
  const knowledge = await knowledgeContext(targetModel);
  const isKling = targetModel.toLowerCase().includes("kling");

  const shotDescription =
    `${shot.title ? shot.title + ". " : ""}${shot.actionMd}` +
    (shot.cameraHint ? ` Камера: ${shot.cameraHint}.` : "") +
    ` Длительность ${shot.durationSec} сек.`;

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
  const candidateIds = await pickTechniqueCandidates(shot.episodeId, shotDescription);
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
        `${settings.tpl_video}\n\n${rules}\n\n${bible}\n\n${knowledge}\n\n${techniquesBlock}\n\n` +
        `Составь промпт для модели ${targetModel} на английском языке, СТРОГО следуя структуре ` +
        "видео-промпта из шаблона выше (для простой сцены без диалога допустим короткий шаблон). " +
        "Обязательно включи в текст промпта: Format: vertical 9:16; Duration; No subtitles. No text overlays; " +
        "блоки Scene/Action/Performance/Camera/Audio/Strict rules; если есть реплика — DIALOGUE LOCK с точным текстом. " +
        (isKling
          ? "Для Kling промпт начинается с описания камеры/ракурса (движение камеры — первым предложением). "
          : "") +
        "Используй element_name сущностей как визуальные якоря. В reference_element_names перечисли " +
        "element_name сущностей, чьи референсы нужно прикрепить к задаче.\n" +
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
