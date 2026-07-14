import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import RefsContent from "../../refs/RefsContent";

export const dynamic = "force-dynamic";

/** Референсы серии в правом слайдере — поверх экрана эпизода, без перезагрузки. */
export default async function RefsDrawer(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const t = await getT();
  return (
    <SideDrawer title={t("Референсы серии", "Episode references")}>
      <RefsContent episodeId={id} />
    </SideDrawer>
  );
}
