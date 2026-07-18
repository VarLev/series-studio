import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import HowItWorksGraph from "@/components/howitworks/HowItWorksGraph";

export const dynamic = "force-dynamic";

/**
 * «How it works» — интерактивная карта устройства приложения (кнопка в
 * «Настройках»). Полноэкранный холст: узлы-подсистемы можно перетаскивать,
 * связывать и читать по ним детали. Маршрут НЕ перехвачен панелью @panel —
 * catchAll закрывает её, и карта открывается на весь экран.
 */
export default async function HowItWorksPage() {
  await requireAuth();
  const t = await getT();
  return (
    <main
      className="flex h-[calc(100dvh-58px-env(safe-area-inset-bottom))] flex-col overflow-hidden lg:h-dvh"
      aria-label={t("Как всё устроено", "How it works")}
    >
      <HowItWorksGraph />
    </main>
  );
}
