import CostsContent from "./CostsContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Затрат» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)costs).
 */
export default function CostsPage() {
  return <CostsContent />;
}
