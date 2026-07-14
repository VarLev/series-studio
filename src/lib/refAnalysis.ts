/**
 * Чистые помощники разбора поля references.analysis (JSON {description, camera}).
 * Вынесены отдельно от lib/refs (серверная оркестрация + vision-вызов), чтобы
 * промпт-фабрика могла импортировать их без цикла factory ↔ refs.
 */
export interface RefAnalysis {
  description: string;
  camera: string;
}

/** Разбор поля references.analysis (JSON) → структура; "" → null. */
export function parseRefAnalysis(s: string | null | undefined): RefAnalysis | null {
  if (!s || !s.trim()) return null;
  try {
    const o = JSON.parse(s) as { description?: string; camera?: string };
    return { description: o.description ?? "", camera: o.camera ?? "" };
  } catch {
    // старый/нештатный формат — считаем всё описанием
    return { description: s, camera: "" };
  }
}

/** Плоский текст анализа для инъекции в промпт и показа в слайдере. */
export function refAnalysisText(s: string | null | undefined): string {
  const a = parseRefAnalysis(s);
  if (!a) return "";
  return [a.description, a.camera ? `Camera: ${a.camera}` : ""].filter(Boolean).join(" ");
}
