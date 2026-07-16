/**
 * Оценка стоимости генераций в реальных $ (клиент-безопасно, без серверных
 * импортов). LLM — по официальным тарифам $/1М токенов; Higgsfield — кредиты
 * подписки в $ по ставке докупки (~$1 за 16 кредитов).
 */

/** Тарифы LLM: $ за 1М входных / выходных токенов. */
export const LLM_PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "gpt-5.6-sol": { in: 5, out: 30 },
  "gpt-5.6-terra": { in: 2.5, out: 15 },
  "gpt-5.6-luna": { in: 1, out: 6 },
  // DeepSeek V4 (июль 2026, cache-miss вход); Gemini 3.5 Flash — бесплатный тир
  "deepseek-v4-pro": { in: 0.435, out: 0.87 },
  "deepseek-v4-flash": { in: 0.14, out: 0.28 },
  "gemini-3.5-flash": { in: 0, out: 0 },
};

/** Типовой объём вывода по задаче (для предварительной оценки $ до запуска). */
export const OUT_TOKENS = { revise: 2500, prompt: 2200 } as const;

/**
 * Ожидаемый объём вывода разбивки. Константы тут не хватало: вывод растёт вместе
 * с сюжетом, и одно число одинаково врало и на короткой серии, и на длинной.
 * Коэффициент снят с реальных прогонов (сюжет 9916 символов → 6.5–12k выходных
 * токенов, в среднем ~9k), потолок — предел вывода моделей.
 */
export function estBreakdownOutTokens(synopsis: string): number {
  return Math.min(120_000, Math.max(2000, Math.round((synopsis || "").length * 0.95)));
}

/**
 * Грубая оценка токенов по длине текста. Делить всё на 4 нельзя: 4 символа на
 * токен — это про латиницу, кириллица токенизируется примерно вдвое плотнее
 * (~2.5 символа на токен), и оценка входа для русских сюжетов занижалась почти
 * в полтора раза — ровно в ту сторону, которая делает кнопку дешевле на вид.
 * Сверено с фактическим usage: сюжет 9916 символов → ~5k входных токенов.
 */
export function estTokens(text: string): number {
  const s = text || "";
  if (!s) return 0;
  const cyrillic = (s.match(/[Ѐ-ӿ]/g) ?? []).length;
  return Math.ceil(cyrillic / 2.5 + (s.length - cyrillic) / 4);
}

/** Оценка стоимости текстовой генерации в $, null — тариф неизвестен. */
export function estTextUsd(model: string, inTokens: number, outTokens: number): number | null {
  const p = LLM_PRICES[model];
  if (!p) return null;
  return (inTokens * p.in + outTokens * p.out) / 1_000_000;
}

/** Кредиты Higgsfield → $ (ставка докупки ~$1 за 16 кредитов). */
export const HF_CREDIT_USD = 1 / 16;
export function creditsToUsd(credits: number): number {
  return credits * HF_CREDIT_USD;
}

/** Форматирование $ с адаптивной точностью (мелкие суммы — 3 знака). */
export function fmtUsd(v: number | null): string {
  if (v == null) return "$?";
  if (v < 0.1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}
