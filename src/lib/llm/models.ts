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
 * Самая дешёвая модель (по LLM_PRICES: Haiku $1/$5 за 1М — минимальный выход).
 * Используется автоматически для механических правок — переделка группы
 * по замечанию (требование заказчика: реворк всегда дешёвой моделью).
 */
export const CHEAPEST_LLM = "claude-haiku-4-5";
