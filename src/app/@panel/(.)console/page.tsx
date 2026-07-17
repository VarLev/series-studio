import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import ConsoleContent from "../../console/ConsoleContent";

export const dynamic = "force-dynamic";

/** Консоль правой панелью — поверх текущего экрана. */
export default async function ConsolePanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("Консоль", "Console")}>
      <ConsoleContent bare />
    </SideDrawer>
  );
}
