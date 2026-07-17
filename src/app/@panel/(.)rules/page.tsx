import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import RulesContent from "../../rules/RulesContent";

export const dynamic = "force-dynamic";

/** База правил правой панелью — поверх текущего экрана. */
export default async function RulesPanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("База правил", "Rules")}>
      <RulesContent />
    </SideDrawer>
  );
}
