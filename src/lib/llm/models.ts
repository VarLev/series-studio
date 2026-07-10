/** Клиент-безопасный список моделей Claude на выбор (без серверных импортов). */
export const LLM_MODELS: Array<{ id: string; label: string; hint: string }> = [
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "самый умный, дороже" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "баланс (по умолчанию)" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "быстрый и дешёвый" },
];
