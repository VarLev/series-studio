import { requireAuth } from "@/lib/auth";
import { ScreenHeader } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import BibleContent from "./BibleContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Библии» — только по прямому URL/перезагрузке. При навигации
 * внутри приложения этот маршрут перехватывается правой панелью
 * (@panel/(.)bible) поверх экрана серий.
 */
export default async function BiblePage() {
  await requireAuth();
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={t("Весь сериал", "Whole series")}
        title={t("Библия сущностей", "Entity bible")}
      />
      <BibleContent />
    </main>
  );
}
