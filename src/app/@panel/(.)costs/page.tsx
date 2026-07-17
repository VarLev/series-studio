import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import CostsContent from "../../costs/CostsContent";

export const dynamic = "force-dynamic";

/**
 * Затраты правой панелью. Открываются и с подвкладки «Настроек», и по ссылке
 * «Затраты →» из панели «Очереди» — оба перехода остаются внутри панели.
 */
export default async function CostsPanel() {
  await requireAuth();
  const t = await getT();
  return (
    <SideDrawer title={t("Затраты", "Costs")}>
      <CostsContent bare />
    </SideDrawer>
  );
}
