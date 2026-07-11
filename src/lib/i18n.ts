/**
 * Двуязычный интерфейс (настройка ui_lang): каждая строка задаётся парой
 * прямо в месте использования — t("Русский", "English"). Без центрального
 * словаря: нечему рассинхронизироваться, строки ищутся грепом.
 */
export type Lang = "ru" | "en";
export type T = (ru: string, en: string) => string;

export function makeT(lang: string): T {
  return (ru, en) => (lang === "en" ? en : ru);
}
