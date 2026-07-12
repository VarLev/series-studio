/**
 * Клиент-безопасный список текстовых моделей на выбор (без серверных импортов).
 * claude-* идут через Anthropic (ANTHROPIC_API_KEY), gpt-* — через OpenAI
 * (OPENAI_API_KEY, оплата отдельная). Маршрутизация по id — в lib/llm/client.ts.
 */
export const LLM_MODELS: Array<{ id: string; label: string; hint: string; hintEn: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "самый умный, дороже", hintEn: "smartest, pricier" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "баланс (по умолчанию)", hintEn: "balanced (default)" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "быстрый и дешёвый", hintEn: "fast and cheap" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "OpenAI, топовая", hintEn: "OpenAI, frontier" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "OpenAI, средняя (~как Sonnet)", hintEn: "OpenAI, mid (~Sonnet)" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "OpenAI, дешёвая (~как Haiku)", hintEn: "OpenAI, budget (~Haiku)" },
];

/**
 * Самая дешёвая модель Anthropic (Haiku $1/$5 за 1М). Фолбэк для
 * «простых запросов» и единственная гарантированная vision-модель.
 */
export const CHEAPEST_LLM = "claude-haiku-4-5";

/**
 * Модели на выбор для «простых запросов» (настройки → Модели): правка групп
 * шотов по замечанию, подбор режиссёрских приёмов, анализ референсов в библии.
 * vision=false (DeepSeek) → анализ изображений автоматически падает на CHEAPEST_LLM.
 * Цены июль-2026: Haiku $1/$5 · Gemini 3.5 Flash бесплатный тир (1500 зап/день) ·
 * DeepSeek V4 Flash $0.14/$0.28 · V4 Pro $0.435/$0.87 за 1М токенов.
 */
export const SIMPLE_LLM_MODELS: Array<{
  id: string;
  label: string;
  hint: string;
  hintEn: string;
  vision: boolean;
}> = [
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    hint: "Anthropic, видит картинки (по умолчанию)",
    hintEn: "Anthropic, vision (default)",
    vision: true,
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    hint: "Google, бесплатный тир, видит картинки",
    hintEn: "Google, free tier, vision",
    vision: true,
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "флагман DeepSeek, дёшево, БЕЗ картинок",
    hintEn: "DeepSeek flagship, cheap, NO vision",
    vision: false,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    hint: "сверхдёшево, БЕЗ картинок",
    hintEn: "ultra-cheap, NO vision",
    vision: false,
  },
];

/**
 * Семейства видеомоделей для промпт-треков: у Seedance и Kling разная
 * рекомендованная структура промпта, поэтому промпты пишутся раздельно.
 */
export type PromptFamily = "seedance" | "kling";

export function promptFamily(targetModel: string): PromptFamily {
  return /kling/i.test(targetModel) ? "kling" : "seedance";
}

/** Метаданные треков: подпись, иконка (public/icons), канонический target_model. */
export const PROMPT_FAMILIES: Array<{
  id: PromptFamily;
  label: string;
  icon: string;
  targetModel: string;
}> = [
  { id: "seedance", label: "Seedance", icon: "/icons/seedance.png", targetModel: "seedance-2.0" },
  { id: "kling", label: "Kling", icon: "/icons/kling.png", targetModel: "kling-3.0" },
];

/** Модель для vision-задач: выбранная «простая», если умеет видеть, иначе Haiku. */
export function visionModelFrom(simpleModel: string): string {
  const meta = SIMPLE_LLM_MODELS.find((m) => m.id === simpleModel);
  if (meta) return meta.vision ? simpleModel : CHEAPEST_LLM;
  // незнакомый id: claude/gemini умеют vision, остальные — фолбэк
  return /^(claude|gemini)/i.test(simpleModel) ? simpleModel : CHEAPEST_LLM;
}
