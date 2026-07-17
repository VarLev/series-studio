import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import KnowledgeContent from "../../knowledge/KnowledgeContent";

export const dynamic = "force-dynamic";

/** База знаний правой панелью — поверх текущего экрана. */
export default async function KnowledgePanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("База знаний", "Knowledge base")}>
      <KnowledgeContent />
    </SideDrawer>
  );
}
