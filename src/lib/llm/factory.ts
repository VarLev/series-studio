/**
 * Промпт-фабрика (M3) и LLM-вызовы M2 — системные промпты собираются из:
 * правил проекта (settings) + релевантных выдержек базы знаний + библии сущностей.
 */
import { asc, eq, inArray, ne } from "drizzle-orm";
import {
  getDb,
  entities,
  episodes,
  knowledgeDocs,
  prompts,
  shots,
  shotEntities,
} from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { listTechniques, techniqueIndex, getTechniquesByIds } from "@/lib/director";
import { runText, runJson } from "./client";
import {
  breakdownSchema,
  shotPromptSchema,
  techniquePickSchema,
  type Breakdown,
  type ShotPrompt,
} from "./contracts";

async function seriesSystemBase(): Promise<{ rules: string; model: string; synopsisModel: string }> {
  const s = await getAllSettings();
  return {
    rules: `Сериал «${s.series_title}». Правила сериала:\n${s.series_rules}`,
    model: s.llm_model,
    synopsisModel: s.llm_model_synopsis,
  };
}

async function previousEpisodesContext(currentEpisodeId: string): Promise<string> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(episodes)
    .where(ne(episodes.id, currentEpisodeId))
    .orderBy(asc(episodes.number));
  if (!rows.length) return "Это первый эпизод сериала.";
  return (
    "Предыдущие эпизоды (логлайны):\n" +
    rows
      .map((e) => `Серия ${e.number} «${e.title}»: ${e.logline || "(логлайн не задан)"}`)
      .join("\n")
  );
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

/** U1/M2 — сгенерировать литературный сюжет эпизода */
export async function llmSynopsis(
  episodeId: string,
  brief: string,
  modelOverride?: string,
): Promise<string> {
  const { rules, synopsisModel } = await seriesSystemBase();
  const prev = await previousEpisodesContext(episodeId);
  const bible = await bibleContext();
  return runText({
    kind: "synopsis",
    model: modelOverride || synopsisModel,
    episodeId,
    maxTokens: 16000,
    system: `${rules}\n\n${prev}\n\n${bible}\n\nТы — сценарист сериала. Пиши литературный сюжет эпизода на русском языке, в формате markdown. Только сюжет, без предисловий.`,
    user: brief || "Напиши сюжет следующего эпизода, развивая историю сериала.",
  });
}

/** M2 — разбить сюжет на группы шотов ≤15 сек (JSON) */
export async function llmBreakdown(
  episodeId: string,
  synopsis: string,
  modelOverride?: string,
): Promise<Breakdown> {
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext();
  return runJson(
    {
      kind: "breakdown",
      model: modelOverride || model,
      episodeId,
      maxTokens: 16000,
      system:
        `${rules}\n\n${bible}\n\n` +
        "Ты — режиссёр раскадровки AI-видео. Разбей сюжет на последовательность видеофрагментов " +
        "(«групп шотов») длительностью до 15 секунд каждый: один фрагмент = одно связное действие, " +
        "которое можно сгенерировать одной видеомоделью. Для каждого укажи задействованные сущности " +
        "строго их element_name из библии (только если они там есть).\n" +
        'Верни ТОЛЬКО JSON без пояснений, схема: {"shots":[{"order":1,"title":"...","duration_sec":15,' +
        '"action":"описание действия","entities":["element_name"],"camera_hint":"движение камеры"}]}',
      user: `Сюжет эпизода:\n\n${synopsis}`,
    },
    breakdownSchema,
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
      user:
        `Действие шота (${shot.durationSec} сек): ${shot.actionMd}\n` +
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
