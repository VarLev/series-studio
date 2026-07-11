/** Статусная модель шота (spec §1) — общая для сервера и клиента. */
export const SHOT_STATUS: Record<
  string,
  { ru: string; en: string; color: string; bg: string; pulse?: boolean }
> = {
  draft: { ru: "Черновик", en: "Draft", color: "var(--text-300)", bg: "rgba(148,140,166,.12)" },
  prompted: { ru: "Промпт готов", en: "Prompt ready", color: "var(--violet-200)", bg: "rgba(139,95,176,.14)" },
  generating: { ru: "Генерация", en: "Generating", color: "var(--warning)", bg: "rgba(192,138,62,.14)", pulse: true },
  review: { ru: "Ревью", en: "Review", color: "var(--magenta-400)", bg: "rgba(178,95,208,.12)" },
  approved: { ru: "Утверждён", en: "Approved", color: "var(--success)", bg: "rgba(79,143,125,.14)" },
  failed: { ru: "Ошибка", en: "Failed", color: "var(--danger)", bg: "rgba(194,71,106,.14)" },
};

export const ENTITY_TYPE_LABEL: Record<string, { ru: string; en: string }> = {
  character: { ru: "Персонаж", en: "Character" },
  location: { ru: "Локация", en: "Location" },
  prop: { ru: "Реквизит", en: "Prop" },
  style: { ru: "Стиль", en: "Style" },
};
