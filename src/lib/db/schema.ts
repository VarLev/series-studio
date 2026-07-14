import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // character | location | prop | style
  name: text("name").notNull(),
  elementName: text("element_name").notNull(),
  description: text("description").notNull().default(""),
  // базовый гардероб персонажа (EN, для промптов) — наследуется группами шотов
  wardrobe: text("wardrobe").notNull().default(""),
  soulId: text("soul_id"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const references = pgTable("references", {
  id: text("id").primaryKey(),
  entityId: text("entity_id"),
  shotId: text("shot_id"),
  episodeId: text("episode_id"),
  storagePath: text("storage_path").notNull(),
  caption: text("caption").notNull().default(""),
  // текстовый анализ изображения vision-моделью (что на референсе): субъекты и их
  // положение, локация, ракурс/кадрирование, свет и настроение. Делается ОДИН раз
  // на загрузке и кэшируется за референсом (по storage_path) — открепление/повторное
  // прикрепление НЕ перезапускает анализ. Уходит в Enhance/Rework и в промпт-фабрику.
  analysis: text("analysis").notNull().default(""),
  source: text("source").notNull().default("upload"), // upload | frame-grab | nano-banana | upscale | edit
  role: text("role"), // start_frame | composition | layout | null
  token: text("token"), // REF_NN — референсы серии (spec §1)
  width: integer("width"),
  height: integer("height"),
  // раскадровка: лист-сетка Nano Banana и вырезанные из него кадры
  grid: integer("grid"), // лист: сколько кадров в сетке (4 = 2×2, 9 = 3×3)
  sbShotId: text("sb_shot_id"), // раскадровка конкретного шота (null = вся серия)
  parentId: text("parent_id"), // кадр: id листа, из которого вырезан
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: text("id").primaryKey(),
  number: integer("number").notNull(),
  title: text("title").notNull().default(""),
  logline: text("logline").notNull().default(""),
  synopsisMd: text("synopsis_md").notNull().default(""),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// UI-wise a "shot" here is the generation unit («группа шотов» in the prototype):
// up to ~15s of video produced by one prompt.
export const shots = pgTable("shots", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull(),
  orderIndex: integer("order_index").notNull(),
  title: text("title").notNull().default(""),
  durationSec: integer("duration_sec").notNull().default(15),
  timecode: text("timecode").notNull().default(""), // «00:00–00:14» внутри эпизода
  // шоты внутри группы: JSON-массив GroupShot (order/time/framing/camera/action/dialogue)
  beatsJson: text("beats_json").notNull().default("[]"),
  actionMd: text("action_md").notNull().default(""),
  cameraHint: text("camera_hint").notNull().default(""),
  // локация группы из разбивки сюжета; едина для сюжетной связки (до следующего
  // scene_start) — правка одной группы обновляет всю связку
  location: text("location").notNull().default(""),
  // время суток и погода (день/ночь/вечер, солнечно/пасмурно/дождь…) — тоже
  // едины на сюжетную связку и уходят в промпты всех связанных групп
  timeWeather: text("time_weather").notNull().default(""),
  // эмоциональный тон группы (спокойный/напряжённый/нежный…): задаёт настроение и
  // атмосферу ИМЕННО этой группы в промпте, перекрывая общий тон сериала. В отличие
  // от локации/погоды — свой у каждой группы (не единый на сцену)
  emotionalTone: text("emotional_tone").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft | prompted | generating | review | approved
  // начало новой сюжетной сцены: жёсткой связности с предыдущей группой нет,
  // общие якоря — только персонажи/локации библии (первая группа — всегда сцена)
  sceneStart: boolean("scene_start").notNull().default(false),
  // вставная группа (спин-офф сцены): создана по запросу пользователя внутри
  // сцены, но живёт отдельно — свои локация/погода/референсы, своя шкала времени
  // от 00:00; в сквозной таймкод эпизода и сюжетную связку сцены НЕ входит
  isInsert: boolean("is_insert").notNull().default(false),
  winnerGenerationId: text("winner_generation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shotEntities = pgTable(
  "shot_entities",
  {
    shotId: text("shot_id").notNull(),
    entityId: text("entity_id").notNull(),
    auto: boolean("auto").notNull().default(false), // determined by Claude vs added manually
    // якорь одежды: наряд персонажа в ЭТОЙ группе (EN); пусто → entities.wardrobe
    outfit: text("outfit").notNull().default(""),
    // источник одежды для промпта: "" | "bible" → базовый гардероб библии,
    // "generated" → сценарный наряд (outfit) из разбивки/ручной правки
    outfitSource: text("outfit_source").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.shotId, t.entityId] })],
);

export const prompts = pgTable("prompts", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").notNull(),
  version: integer("version").notNull(),
  parentId: text("parent_id"),
  targetModel: text("target_model").notNull().default("kling-3.0"),
  text: text("text").notNull(),
  negativePrompt: text("negative_prompt"),
  paramsJson: text("params_json").notNull().default("{}"),
  feedbackNote: text("feedback_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generations = pgTable("generations", {
  id: text("id").primaryKey(),
  // null для задач-референсов (kind = reference), привязанных только к эпизоду
  shotId: text("shot_id"),
  episodeId: text("episode_id"),
  kind: text("kind").notNull().default("video"), // video | reference
  promptId: text("prompt_id"),
  provider: text("provider").notNull().default("manual"), // higgsfield | manual
  model: text("model").notNull().default("kling-web"),
  paramsJson: text("params_json").notNull().default("{}"),
  status: text("status").notNull().default("done"), // queued | running | done | failed | nsfw
  // победителей может быть несколько (замечание заказчика) — флаг на генерации
  winner: boolean("winner").notNull().default(false),
  providerJobId: text("provider_job_id"),
  resultStoragePath: text("result_storage_path"),
  // кредиты бывают дробными (Seedance 22.5) — real, не integer
  creditsSpent: real("credits_spent"),
  error: text("error"),
  source: text("source").notNull().default("api"), // api | kling-web | manual
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Якоря — короткие текстовые инъекции-детали, которых не хватает референсам/энтити/
 * тону: «синяк на лице», «красная куртка», «на столе разбитая чашка». Живут за
 * ЭПИЗОДОМ (создаются в группе, но сохраняются в пул эпизода) и переиспользуются:
 * один якорь цепляется к нескольким группам через shot_anchors. При генерации
 * видео-промпта, Enhance и Rework прикреплённые якоря — ОБЯЗАТЕЛЬНЫЕ пометки.
 */
export const anchors = pgTable("anchors", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull(),
  text: text("text").notNull(),
  source: text("source").notNull().default("manual"), // manual | enhance
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Привязка якоря к группе шотов (many-to-many): один якорь — на N групп. */
export const shotAnchors = pgTable(
  "shot_anchors",
  {
    shotId: text("shot_id").notNull(),
    anchorId: text("anchor_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shotId, t.anchorId] })],
);

export const knowledgeDocs = pgTable("knowledge_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourceFile: text("source_file").notNull(),
  contentMd: text("content_md").notNull(),
  tags: text("tags").notNull().default(""), // comma-separated: kling,seedance,camera,realism...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Каталог моделей генерации (TZ §0.2: не хардкодить — получать программно
 * и хранить в БД с возможностью обновления).
 */
export const videoModels = pgTable("video_models", {
  id: text("id").primaryKey(), // provider model id, e.g. kling3_0
  name: text("name").notNull(),
  kind: text("kind").notNull().default("video"), // video | image
  provider: text("provider").notNull().default("higgsfield"),
  paramsJson: text("params_json").notNull().default("{}"), // allowed params/enums
  credits: real("credits"), // база оценки за задачу (бывает дробной: Seedance 22.5)
  active: boolean("active").notNull().default(true),
  sortIndex: integer("sort_index").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Библиотека режиссёрских приёмов: карточки промптов (сид — JSFilmz Vault 500),
 * пользователь может добавлять/править/удалять свои. Промпт-фабрика подбирает
 * подходящие приёмы к шоту и вплетает их в видео-промпт.
 */
export const techniques = pgTable("techniques", {
  id: text("id").primaryKey(), // b19 из вольта либо uuid для своих
  title: text("title").notNull(),
  category: text("category").notNull().default(""),
  camera: text("camera").notNull().default(""),
  lens: text("lens").notNull().default(""),
  lighting: text("lighting").notNull().default(""),
  tags: text("tags").notNull().default(""),
  prompt: text("prompt").notNull(),
  negative: text("negative").notNull().default(""),
  custom: boolean("custom").notNull().default(false), // добавлен пользователем
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmUsage = pgTable("llm_usage", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // synopsis | breakdown | prompt | revision
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  episodeId: text("episode_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Консоль (вкладка «Console»): журнал ВСЕХ обращений к моделям — что и в каком
 * виде ушло и что пришло в ответ. Пишется на двух воронках: текстовые LLM-вызовы
 * (client.runText) и постановка задач генерации видео/картинок (generation.ts).
 */
export const modelLog = pgTable("model_log", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull().default("llm"), // llm | video | image
  kind: text("kind").notNull().default(""), // analysis | breakdown | prompt | … | video | reference
  provider: text("provider").notNull().default(""), // anthropic | openai | gemini | higgsfield-mcp | kling-mcp | google
  model: text("model").notNull().default(""),
  status: text("status").notNull().default("ok"), // ok | error
  // что отправлено (system/user/prompt/params/hasImage) и что пришло (text/jobId/error/usage)
  requestJson: text("request_json").notNull().default("{}"),
  responseJson: text("response_json").notNull().default("{}"),
  // прикреплённые референсы: [{id, caption, role}] — превью резолвит страница
  refsJson: text("refs_json").notNull().default("[]"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  episodeId: text("episode_id"),
  shotId: text("shot_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
