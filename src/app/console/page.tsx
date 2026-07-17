import ConsoleContent from "./ConsoleContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Консоли» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)console).
 */
export default function ConsolePage() {
  return <ConsoleContent />;
}
