import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb, settings } from "./db";
import {
  DEFAULT_BREAKDOWN_TEMPLATE,
  DEFAULT_KLING_VIDEO_TEMPLATE,
  DEFAULT_STORYBOARD_TEMPLATE,
  DEFAULT_VIDEO_TEMPLATE,
} from "./templates";

export const DEFAULT_SETTINGS = {
  llm_model: "claude-sonnet-4-6",
  // модель для простых запросов: правка групп, подбор приёмов, анализ референсов
  llm_simple_model: "claude-haiku-4-5",
  series_title: "The Edge of Stigma",
  series_rules:
    "Жанр: тёмная романтика / психологический триллер (Boys Love). " +
    "Тон: психологическое напряжение, никакого гламура. " +
    "Сеттинг: университет Эшфорд. " +
    "Запреты: без явной эротики, без романтизации насилия.",
  credit_confirm_limit: "50",
  target_models: "kling3_0,seedance_2_0",
  llm_price_in: "3", // $ за 1М входных токенов (конфигурируемый тариф, TZ M7)
  llm_price_out: "15", // $ за 1М выходных токенов
  // шаблоны промптов (редактируются в «Настройках»)
  tpl_breakdown: DEFAULT_BREAKDOWN_TEMPLATE,
  tpl_storyboard: DEFAULT_STORYBOARD_TEMPLATE,
  tpl_video: DEFAULT_VIDEO_TEMPLATE, // трек Seedance
  tpl_video_kling: DEFAULT_KLING_VIDEO_TEMPLATE, // трек Kling (<<<image_N>>>, нативный звук)
  // интерфейс
  ui_lang: "ru", // ru | en
  ui_theme: "stigma", // stigma (фиолетовый) | vault (графит + янтарь)
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export { LLM_MODELS } from "./llm/models";

export async function getSetting(key: SettingKey): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? DEFAULT_SETTINGS[key];
}

// cache(): layout и страница читают настройки в одном запросе — БД дёргается один раз
export const getAllSettings = cache(async (): Promise<Record<SettingKey, string>> => {
  const db = await getDb();
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    if (map[key] !== undefined) result[key] = map[key];
  }
  return result;
});

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
