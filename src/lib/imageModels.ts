/**
 * Метаданные image-моделей (клиент-безопасно, без серверных импортов).
 * Nano Banana через Google Gemini API — оплата в долларах; через Higgsfield —
 * в кредитах подписки. Цены Google по официальному прайсу (ai.google.dev, 2026).
 */
export type CostUnit = "usd" | "credits";

export interface ImageModelMeta {
  id: string; // id в каталоге приложения
  apiModel?: string; // реальный id модели у провайдера (Google)
  label: string;
  hint: string;
  hintEn: string;
  unit: CostUnit;
  /** стоимость за картинку по ключу качества (1k|2k|4k) */
  cost: Record<string, number>;
}

/** Google Gemini image-модели (когда задан GEMINI_API_KEY). */
export const GOOGLE_IMAGE_MODELS: ImageModelMeta[] = [
  {
    id: "nano_banana_pro",
    apiModel: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    hint: "макс. качество, текст и композиция",
    hintEn: "max quality, text & composition",
    unit: "usd",
    cost: { "1k": 0.134, "2k": 0.134, "4k": 0.24 },
  },
  {
    id: "nano_banana_light",
    apiModel: "gemini-3.1-flash-lite-image",
    label: "Nano Banana Light",
    hint: "быстрее и дешевле, для черновиков",
    hintEn: "faster & cheaper, for drafts",
    unit: "usd",
    cost: { "1k": 0.04, "2k": 0.06, "4k": 0.1 },
  },
];

/** Higgsfield image-модель (когда Google не задан). */
export const HIGGSFIELD_IMAGE_MODELS: ImageModelMeta[] = [
  {
    id: "nano_banana_2",
    label: "Nano Banana",
    hint: "через подписку Higgsfield",
    hintEn: "via Higgsfield subscription",
    unit: "credits",
    cost: { "1k": 4, "2k": 6, "4k": 10 },
  },
];

export function imageModelMeta(id: string): ImageModelMeta | undefined {
  return [...GOOGLE_IMAGE_MODELS, ...HIGGSFIELD_IMAGE_MODELS].find((m) => m.id === id);
}

/** «$0.13» или «6 кр» под текущий язык/провайдера. */
export function formatImageCost(id: string, quality: string, en: boolean): string {
  const meta = imageModelMeta(id);
  if (!meta) return "";
  const value = meta.cost[quality] ?? Object.values(meta.cost)[0] ?? 0;
  return meta.unit === "usd" ? `$${value.toFixed(2)}` : `${value} ${en ? "cr" : "кр"}`;
}
