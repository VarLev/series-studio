/**
 * Итоговый наряд персонажа в группе шотов.
 *
 * Правило (заказчик): одежда ВСЕГДА берётся из библии (базовый гардероб),
 * исключение — если сюжет явно описал, как персонаж выглядит в этой сцене.
 * Такой «сценарный» наряд разбивка кладёт в shot_entities.outfit и помечает
 * источник "generated"; тогда он и уходит в промпт. Во всех прочих случаях
 * (источник "" | "bible") используется базовый гардероб из библии.
 */
export function effectiveOutfit(
  link: { outfit?: string | null; outfitSource?: string | null } | undefined,
  wardrobe: string | null | undefined,
): string {
  const generated = (link?.outfit ?? "").trim();
  const bible = (wardrobe ?? "").trim();
  return link?.outfitSource === "generated" ? generated || bible : bible;
}
