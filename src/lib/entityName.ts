/**
 * element_name всегда начинается ровно с одного «@» (требование заказчика).
 * Нормализация убирает задвоение (@@Craig → @Craig) и добавляет @, если нет.
 */
export function normalizeElementName(raw: string): string {
  const body = (raw || "").trim().replace(/^@+/, "").trim();
  return body ? `@${body}` : "";
}

/** element_name без ведущих @ и в нижнем регистре — для сопоставления с библией. */
export function stripAt(s: string): string {
  return (s || "").replace(/^@+/, "").trim().toLowerCase();
}

/** Схлопнуть задвоенные @@ в тексте промпта до одного. */
export function collapseAt(text: string): string {
  return (text || "").replace(/@{2,}/g, "@");
}
