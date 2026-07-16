import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import QueueContent from "../../queue/QueueContent";

export const dynamic = "force-dynamic";

/** Очередь задач правой панелью — поверх текущего экрана. */
export default async function QueuePanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("Очередь задач", "Job queue")}>
      <QueueContent />
    </SideDrawer>
  );
}
