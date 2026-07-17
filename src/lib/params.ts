/**
 * Единая точка разбора JSON из БД (params_json / beats_json и пр.): битая строка
 * НЕ должна ронять всю страницу. Инцидент-класс: одна кривая запись → 500 на /queue,
 * потому что рендер парсил paramsJson голым JSON.parse. Возвращает fallback, если
 * строка пустая или не парсится.
 */
export function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
