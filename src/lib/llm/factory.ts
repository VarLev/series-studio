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
import { runText, runJson } from "./client";
import { breakdownSchema, shotPromptSchema, type Breakdown, type ShotPrompt } from "./contracts";

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

/** M3 — сгенерировать промпт для шота под целевую модель (JSON) */
export async function llmShotPrompt(shotId: string, targetModel: string): Promise<ShotPrompt> {
  const db = await getDb();
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) throw new Error("Шот не найден");
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const { rules, model } = await seriesSystemBase();
  const bible = await bibleContext(links.map((l) => l.entityId));
  const knowledge = await knowledgeContext(targetModel);
  const isKling = targetModel.toLowerCase().includes("kling");
  return runJson(
    {
      kind: "prompt",
      model,
      episodeId: shot.episodeId,
      maxTokens: 4096,
      system:
        `${rules}\n\n${bible}\n\n${knowledge}\n\n` +
        `Ты — промпт-инженер видеогенерации. Составь промпт для модели ${targetModel} на английском языке. ` +
        (isKling
          ? "Для Kling промпт начинается с описания камеры/ракурса (движение камеры — первым предложением). "
          : "") +
        "Используй element_name сущностей как визуальные якоря. В reference_element_names перечисли " +
        "element_name сущностей, чьи референсы нужно прикрепить к задаче.\n" +
        'Верни ТОЛЬКО JSON: {"prompt":"...","negative_prompt":"...","reference_element_names":["..."],' +
        '"params":{"aspect_ratio":"16:9","duration":15}}',
      user:
        `Действие шота (${shot.durationSec} сек): ${shot.actionMd}\n` +
        (shot.cameraHint ? `Подсказка по камере: ${shot.cameraHint}\n` : "") +
        (shot.title ? `Название: ${shot.title}` : ""),
    },
    shotPromptSchema,
  );
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
  const { rules, model } = await seriesSystemBase();
  const knowledge = await knowledgeContext(prev.targetModel);
  return runJson(
    {
      kind: "revision",
      model,
      episodeId: shot?.episodeId,
      maxTokens: 4096,
      system:
        `${rules}\n\n${knowledge}\n\n` +
        `Ты — промпт-инженер видеогенерации (модель ${prev.targetModel}). Улучши промпт с учётом замечания, ` +
        "сохранив работающие части. Промпт на английском.\n" +
        'Верни ТОЛЬКО JSON: {"prompt":"...","negative_prompt":"...","reference_element_names":["..."],' +
        '"params":{"aspect_ratio":"16:9","duration":15}}',
      user:
        `Текущий промпт (v${prev.version}):\n${prev.text}\n\n` +
        (prev.negativePrompt ? `Negative: ${prev.negativePrompt}\n\n` : "") +
        `Замечание пользователя: ${feedback}` +
        (failureReason ? `\n\nПричина отказа генерации: ${failureReason}` : ""),
    },
    shotPromptSchema,
  );
}
