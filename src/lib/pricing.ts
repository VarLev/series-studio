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
};

/** Типовой объём вывода по задаче (для предварительной оценки $ до запуска). */
export const OUT_TOKENS = { breakdown: 9000, revise: 2500, prompt: 2200 } as const;

/** Грубая оценка токенов по длине текста (~4 символа на токен). */
export function estTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
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
