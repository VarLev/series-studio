import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SettingsHeader from "@/components/settings/SettingsHeader";
import SettingsContent from "./SettingsContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Настроек» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)settings).
 */
export default async function SettingsPage() {
  await requireAuth();
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <SettingsHeader
        title={t("Настройки", "Settings")}
        subtitle={t(
          "Язык и стиль, шаблоны промптов, библиотека режиссёрских приёмов.",
          "Language & style, prompt templates, director technique library.",
        )}
      />
      <SettingsContent />
    </main>
  );
}
