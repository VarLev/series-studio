import { requireAuth } from "@/lib/auth";
import { ScreenHeader } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import QueueContent from "./QueueContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница «Очереди» — только по прямому URL/перезагрузке; внутри
 * приложения маршрут перехватывается правой панелью (@panel/(.)queue).
 */
export default async function QueuePage() {
  await requireAuth();
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader
        backHref="/episodes"
        eyebrow={t("Higgsfield · все серии", "Higgsfield · all episodes")}
        title={t("Очередь задач", "Job queue")}
      />
      <QueueContent />
    </main>
  );
}
