import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import BibleContent from "../../bible/BibleContent";

export const dynamic = "force-dynamic";

/** Библия правой панелью — поверх текущего экрана, без его перезагрузки. */
export default async function BiblePanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("Библия сущностей", "Entity bible")}>
      <BibleContent />
    </SideDrawer>
  );
}
