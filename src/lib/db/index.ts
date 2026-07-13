import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
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
`;

type GlobalWithDb = typeof globalThis & { __ssDb?: Promise<DB> };

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
  for (const stmt of SCHEMA_SQL.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed) await db.execute(sql.raw(trimmed));
  }
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
