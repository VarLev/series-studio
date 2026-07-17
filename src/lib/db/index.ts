import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";

export type DB = PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  id text PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  element_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  soul_id text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "references" (
  id text PRIMARY KEY,
  entity_id text,
  shot_id text,
  episode_id text,
  storage_path text NOT NULL,
  caption text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'upload',
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS episodes (
  id text PRIMARY KEY,
  number integer NOT NULL,
  title text NOT NULL DEFAULT '',
  logline text NOT NULL DEFAULT '',
  synopsis_md text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shots (
  id text PRIMARY KEY,
  episode_id text NOT NULL,
  order_index integer NOT NULL,
  title text NOT NULL DEFAULT '',
  duration_sec integer NOT NULL DEFAULT 15,
  action_md text NOT NULL DEFAULT '',
  camera_hint text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  winner_generation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shot_entities (
  shot_id text NOT NULL,
  entity_id text NOT NULL,
  auto boolean NOT NULL DEFAULT false,
  PRIMARY KEY (shot_id, entity_id)
);
CREATE TABLE IF NOT EXISTS prompts (
  id text PRIMARY KEY,
  shot_id text NOT NULL,
  version integer NOT NULL,
  parent_id text,
  target_model text NOT NULL DEFAULT 'kling-3.0',
  text text NOT NULL,
  negative_prompt text,
  params_json text NOT NULL DEFAULT '{}',
  feedback_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS generations (
  id text PRIMARY KEY,
  shot_id text,
  episode_id text,
  kind text NOT NULL DEFAULT 'video',
  prompt_id text,
  provider text NOT NULL DEFAULT 'manual',
  model text NOT NULL DEFAULT 'kling-web',
  params_json text NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'done',
  provider_job_id text,
  result_storage_path text,
  credits_spent integer,
  error text,
  source text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id text PRIMARY KEY,
  title text NOT NULL,
  source_file text NOT NULL,
  content_md text NOT NULL,
  tags text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_models (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'video',
  provider text NOT NULL DEFAULT 'higgsfield',
  params_json text NOT NULL DEFAULT '{}',
  credits integer,
  active boolean NOT NULL DEFAULT true,
  sort_index integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS techniques (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL DEFAULT '',
  camera text NOT NULL DEFAULT '',
  lens text NOT NULL DEFAULT '',
  lighting text NOT NULL DEFAULT '',
  tags text NOT NULL DEFAULT '',
  prompt text NOT NULL,
  negative text NOT NULL DEFAULT '',
  custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS llm_usage (
  id text PRIMARY KEY,
  kind text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  episode_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_log (
  id text PRIMARY KEY,
  channel text NOT NULL DEFAULT 'llm',
  kind text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ok',
  request_json text NOT NULL DEFAULT '{}',
  response_json text NOT NULL DEFAULT '{}',
  refs_json text NOT NULL DEFAULT '[]',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  episode_id text,
  shot_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_log_created_idx ON model_log (created_at DESC);
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS grid integer;
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS sb_shot_id text;
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS parent_id text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS episode_id text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'video';
ALTER TABLE generations ALTER COLUMN shot_id DROP NOT NULL;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS timecode text NOT NULL DEFAULT '';
ALTER TABLE shots ADD COLUMN IF NOT EXISTS beats_json text NOT NULL DEFAULT '[]';
ALTER TABLE generations ADD COLUMN IF NOT EXISTS winner boolean NOT NULL DEFAULT false;
ALTER TABLE video_models ALTER COLUMN credits TYPE real;
ALTER TABLE generations ALTER COLUMN credits_spent TYPE real;
UPDATE generations SET winner = true WHERE id IN (SELECT winner_generation_id FROM shots WHERE winner_generation_id IS NOT NULL);
UPDATE shots SET winner_generation_id = NULL WHERE winner_generation_id IS NOT NULL;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS wardrobe text NOT NULL DEFAULT '';
ALTER TABLE shot_entities ADD COLUMN IF NOT EXISTS outfit text NOT NULL DEFAULT '';
ALTER TABLE shot_entities ADD COLUMN IF NOT EXISTS outfit_source text NOT NULL DEFAULT '';
DELETE FROM settings WHERE key LIKE 'hf_element_%' OR key LIKE 'hf_media2_%';
UPDATE settings SET value = 'kling3_0,seedance_2_0_fast' WHERE key = 'target_models' AND value = 'kling3_0,seedance_2_0';
ALTER TABLE shots ADD COLUMN IF NOT EXISTS scene_start boolean NOT NULL DEFAULT false;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';
ALTER TABLE shots ADD COLUMN IF NOT EXISTS time_weather text NOT NULL DEFAULT '';
ALTER TABLE shots ADD COLUMN IF NOT EXISTS is_insert boolean NOT NULL DEFAULT false;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS emotional_tone text NOT NULL DEFAULT '';
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS analysis text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS anchors (
  id text PRIMARY KEY,
  episode_id text NOT NULL,
  text text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anchors_episode_idx ON anchors (episode_id);
CREATE TABLE IF NOT EXISTS shot_anchors (
  shot_id text NOT NULL,
  anchor_id text NOT NULL,
  PRIMARY KEY (shot_id, anchor_id)
);
CREATE INDEX IF NOT EXISTS shots_episode_idx ON shots (episode_id);
CREATE INDEX IF NOT EXISTS generations_shot_idx ON generations (shot_id);
CREATE INDEX IF NOT EXISTS generations_episode_idx ON generations (episode_id);
CREATE INDEX IF NOT EXISTS generations_status_idx ON generations (status);
CREATE INDEX IF NOT EXISTS references_shot_idx ON "references" (shot_id);
CREATE INDEX IF NOT EXISTS references_entity_idx ON "references" (entity_id);
CREATE INDEX IF NOT EXISTS references_episode_idx ON "references" (episode_id);
CREATE INDEX IF NOT EXISTS prompts_shot_idx ON prompts (shot_id);
CREATE INDEX IF NOT EXISTS shot_anchors_anchor_idx ON shot_anchors (anchor_id);
`;

/**
 * Версионированные миграции схемы. На холодном старте прогоняются ТОЛЬКО ещё не
 * применённые версии (текущая хранится в settings.schema_version), а не все ~70
 * стейтментов каждый раз — включая data-fix UPDATE/DELETE, которые теперь
 * выполняются ровно один раз. Миграция №0 — исходный SCHEMA_SQL целиком: она
 * идемпотентна (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, а её data-fix
 * идемпотентны по факту предыдущего состояния), поэтому существующие БД переживут
 * её один раз без вреда. Заморожена: НОВЫЕ изменения схемы добавлять отдельными
 * элементами массива — списком стейтментов (НЕ режем по ";", поэтому точка с
 * запятой внутри строкового литерала больше ничего не ломает).
 */
const MIGRATIONS: string[][] = [
  // v0 — заморожена; правки схемы идут новыми версиями ниже
  SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean),
  // v1 — раскадровка знает, какая панель про какую группу: лист хранит карту
  // «панель → группа» (sb_panels), кадр — свой номер панели (sb_panel). Отсюда
  // разрезка проставляет кадрам их группы, а кадры становятся стартовыми
  // кадрами этих групп в один тап.
  [
    `ALTER TABLE "references" ADD COLUMN IF NOT EXISTS sb_panels text`,
    `ALTER TABLE "references" ADD COLUMN IF NOT EXISTS sb_panel integer`,
  ],
  // v2 — персонажи из разбивки, которых нет в библии: раньше они молча терялись,
  // теперь висят на группе красными чипами-заготовками до решения пользователя
  [`ALTER TABLE shots ADD COLUMN IF NOT EXISTS unlinked_chars_json text NOT NULL DEFAULT '[]'`],
  // v3 — вкл/выкл документов базы знаний: выключенный док остаётся в базе,
  // но не подмешивается в промпт-фабрику (вкладка «База знаний» в настройках)
  [`ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`],
  // v4 — заготовка поштучного вкл/выкл приёмов; отменена в v5 (выключатель нужен
  // один на всю библиотеку). Версию не удаляем: на БД, где v4 уже применилась,
  // изменение её текста задним числом не выполнится — чинит только следующая версия
  [`ALTER TABLE techniques ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`],
  // v5 — вкл/выкл библиотеки приёмов целиком живёт в settings.techniques_enabled,
  // поштучная колонка не нужна
  [`ALTER TABLE techniques DROP COLUMN IF EXISTS enabled`],
  // v6 — маркеры смены шота на таймлайне видео: за каждым видео закрепляется
  // снапшот шотов группы на момент постановки задачи, независимый от дальнейших
  // правок группы. Бэкфилла нет намеренно — для старых видео состояние группы «на
  // момент генерации» неизвестно, а подставлять им текущее было бы враньём
  [`ALTER TABLE generations ADD COLUMN IF NOT EXISTS beats_json text`],
];

type GlobalWithDb = typeof globalThis & { __ssDb?: Promise<DB> };

async function runMigrations(db: DB): Promise<void> {
  const latest = MIGRATIONS.length - 1;
  // текущая версия схемы; если settings ещё нет (совсем новая БД) или ключа нет —
  // стартуем с нуля (прогоняем всё). Мусор в значении тоже трактуем как «с нуля».
  let current = -1;
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "schema_version"));
    if (row?.value != null) {
      const v = Number(row.value);
      if (Number.isInteger(v) && v >= 0) current = v;
    }
  } catch {
    current = -1; // таблицы settings ещё не существует — совсем новая БД
  }
  for (let v = current + 1; v <= latest; v++) {
    for (const stmt of MIGRATIONS[v]) {
      if (stmt) await db.execute(sql.raw(stmt));
    }
  }
  if (current < latest) {
    await db
      .insert(schema.settings)
      .values({ key: "schema_version", value: String(latest) })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(latest) } });
  }
}

async function createDb(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
    db = drizzlePostgres(client, { schema });
  } else {
    // Local mode: embedded Postgres (PGlite), data lives in .data/pglite
    const { PGlite } = await import("@electric-sql/pglite");
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const dataDir = path.join(process.cwd(), ".data", "pglite");
    await fs.mkdir(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    db = drizzlePglite(client, { schema });
  }
  await runMigrations(db);
  return db;
}

export function getDb(): Promise<DB> {
  const g = globalThis as GlobalWithDb;
  if (!g.__ssDb) {
    g.__ssDb = createDb().catch((e) => {
      g.__ssDb = undefined; // do not cache a failed init
      throw e;
    });
  }
  return g.__ssDb;
}

export * from "./schema";
