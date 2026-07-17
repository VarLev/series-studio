import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SettingsHeader from "@/components/settings/SettingsHeader";
import KnowledgeContent from "./KnowledgeContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Базы знаний» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)knowledge).
 */
export default async function KnowledgePage() {
  await requireAuth();
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <SettingsHeader
        title={t("База знаний", "Knowledge base")}
        subtitle={t(
          "Методички промпт-фабрики: что ИИ-сценарист читает перед написанием видео-промптов.",
          "Prompt-factory handbooks: what the prompt-writer AI reads before writing video prompts.",
        )}
      />
      <KnowledgeContent />
    </main>
  );
}
