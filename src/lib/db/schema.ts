import {
  pgTable,
  text,
  integer,
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
  source: text("source").notNull().default("upload"), // upload | frame-grab | nano-banana | upscale | edit
  role: text("role"), // start_frame | composition | null
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
  status: text("status").notNull().default("draft"), // draft | prompted | generating | review | approved
  winnerGenerationId: text("winner_generation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shotEntities = pgTable(
  "shot_entities",
  {
    shotId: text("shot_id").notNull(),
    entityId: text("entity_id").notNull(),
    auto: boolean("auto").notNull().default(false), // determined by Claude vs added manually
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
  creditsSpent: integer("credits_spent"),
  error: text("error"),
  source: text("source").notNull().default("api"), // api | kling-web | manual
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  credits: integer("credits"), // estimate per job, if known
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
