import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SettingsHeader from "@/components/settings/SettingsHeader";
import RulesContent from "./RulesContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Базы правил» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)rules).
 */
export default async function RulesPage() {
  await requireAuth();
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <SettingsHeader
        title={t("База правил", "Rules")}
        subtitle={t(
          "Все инструкции, которые уходят моделям: свои правила, системные правила, программные блоки, правила из шаблонов и режиссёрские приёмы.",
          "Every instruction sent to the models: your rules, system rules, dynamic blocks, template-derived rules and director techniques.",
        )}
      />
      <RulesContent />
    </main>
  );
}
