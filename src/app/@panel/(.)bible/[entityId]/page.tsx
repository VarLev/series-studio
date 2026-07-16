import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import EntityContent, { entityName } from "../../../bible/[entityId]/EntityContent";

export const dynamic = "force-dynamic";

/**
 * Сущность библии внутри той же правой панели: тап по карточке в списке не
 * открывает новый экран, а меняет содержимое панели. «Назад» (router.back())
 * возвращает к списку, основной экран под панелью при этом не трогается.
 */
export default async function EntityPanel(ctx: { params: Promise<{ entityId: string }> }) {
  await requireAuth();
  const { entityId } = await ctx.params;
  const t = await getT();
  const name = await entityName(entityId);
  return (
    <SideDrawer title={name || t("Сущность", "Entity")} nested>
      <EntityContent entityId={entityId} />
    </SideDrawer>
  );
}
