import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import SettingsContent from "../../settings/SettingsContent";

export const dynamic = "force-dynamic";

/** Настройки правой панелью — поверх текущего экрана. */
export default async function SettingsPanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("Настройки", "Settings")}>
      <SettingsContent />
    </SideDrawer>
  );
}
