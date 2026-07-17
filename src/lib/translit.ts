/**
 * Транслитерация кириллицы в латиницу и построение имён для файловой системы.
 * Нужно для экспорта: имена видео и папки CapCut-черновика — латиницей из названия
 * эпизода (заказчик: «Название_эпизода_на_латинице»).
 */

const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};

/** Кириллица → латиница с сохранением регистра (Ж → Zh, ж → zh). */
export function translit(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = MAP[lower];
    if (mapped === undefined) {
      out += ch; // латиница/цифры/пунктуация — как есть
    } else if (ch === lower) {
      out += mapped; // строчная
    } else {
      // прописная: капитализируем многобуквенную замену (Щ → Sch)
      out += mapped ? mapped[0].toUpperCase() + mapped.slice(1) : "";
    }
  }
  return out;
}

/**
 * Безопасное для файловой системы имя из строки: транслит + только [A-Za-z0-9],
 * прочее → «_», схлопывание и обрезка. Пусто → fallback.
 */
export function latinSlug(input: string, fallback = "episode"): string {
  const slug = translit(input)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}
