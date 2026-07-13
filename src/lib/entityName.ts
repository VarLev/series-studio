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

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Имена персонажей в тексте промпта должны стоять ТОЛЬКО как @element_name
 * (@Simon), а не обычным именем собственным. Заменяет имена на их якорь ВНЕ
 * кавычек; внутри реплик ("…", «…») — оставляет как есть (собственные имена
 * допустимы только в диалогах). Идемпотентно: уже @-префиксные не трогает.
 * Регистрозависимо — чтобы не ловить случайные слова.
 */
export function anchorCharacterNames(
  text: string,
  chars: Array<{ name: string; elementName: string }>,
): string {
  const list = chars
    .map((c) => ({ name: (c.name || "").trim(), anchor: normalizeElementName(c.elementName) }))
    .filter((c) => c.name && c.anchor)
    // длинные имена первыми: «Simon Blackwood» не порежется на части
    .sort((a, b) => b.name.length - a.name.length);
  if (!list.length) return text;

  const anchorOutside = (segment: string): string => {
    let s = segment;
    for (const c of list) {
      // имя как отдельное слово, не предварённое @/буквой и не часть слова
      s = s.replace(new RegExp(`(?<![@\\w])${escapeReg(c.name)}(?![\\w])`, "g"), c.anchor);
    }
    return s;
  };

  // защищаем содержимое кавычек-реплик; апострофы (Jacob's) намеренно не считаем
  const quoteRe = /"[^"]*"|«[^»]*»/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(text)) !== null) {
    out += anchorOutside(text.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  out += anchorOutside(text.slice(last));
  return out;
}
