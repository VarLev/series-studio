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
  // "1" → текстовые Claude-вызовы идут через Claude Code CLI (подписка Pro/Max,
  // не тратит API-деньги). Vision и не-Claude модели всегда через свои API.
  llm_use_cli: "0",
  // "1" → текстовые GPT-вызовы идут через OpenAI Codex CLI (подписка ChatGPT
  // Plus/Pro, не тратит API-деньги OpenAI). По умолчанию ВКЛючено — все GPT-
  // запросы идут через CLI. Vision-GPT всегда через API. Нужен `codex login`.
  llm_use_cli_gpt: "1",
  series_title: "The Edge of Stigma",
  series_rules:
    "Жанр: тёмная романтика / психологический триллер (Boys Love). " +
    "Тон: психологическое напряжение, никакого гламура. " +
    "Сеттинг: университет Эшфорд. " +
    "Запреты: без явной эротики, без романтизации насилия.",
  // единый визуальный стиль сериала — вставляется в КАЖДЫЙ промпт ДОСЛОВНО, чтобы
  // атмосфера/грейдинг не «плавали» от версии к версии
  series_style:
    "Dark romance psychological thriller. Natural low-light realism, muted ungraded colors, " +
    "realistic skin tones. No glossy music-video look, no polished fantasy glow, no cartoon look.",
  credit_confirm_limit: "50",
  // по умолчанию для Seedance берём Fast-вариант (дешевле/быстрее)
  target_models: "kling3_0,seedance_2_0_fast",
  llm_price_in: "3", // $ за 1М входных токенов (конфигурируемый тариф, TZ M7)
  llm_price_out: "15", // $ за 1М выходных токенов
  // шаблоны промптов (редактируются в «Настройках»)
  tpl_breakdown: DEFAULT_BREAKDOWN_TEMPLATE,
  tpl_storyboard: DEFAULT_STORYBOARD_TEMPLATE,
  tpl_video: DEFAULT_VIDEO_TEMPLATE, // трек Seedance
  tpl_video_kling: DEFAULT_KLING_VIDEO_TEMPLATE, // трек Kling (<<<image_N>>>, нативный звук)
  // "0" → библиотека режиссёрских приёмов выключена целиком: приёмы не уходят в
  // модель совсем (ни в индекс Enhance, ни в промпт шота, ни в пикер на карточке).
  // Выключатель — на вкладке «База знаний», над библиотекой
  techniques_enabled: "1",
  // «База правил» (/rules): JSON-массив id выключенных системных правил и
  // динамических блоков реестра (rulesRegistry). Нет id в массиве = включено.
  rules_disabled: "[]",
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
