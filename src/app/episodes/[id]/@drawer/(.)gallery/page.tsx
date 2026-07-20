import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import SideDrawer from "@/components/SideDrawer";
import GalleryContent from "../../gallery/GalleryContent";

export const dynamic = "force-dynamic";

/** Галерея видео в правом слайдере — поверх экрана эпизода, без перезагрузки. */
export default async function GalleryDrawer(ctx: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await ctx.params;
  const t = await getT();
  return (
    <SideDrawer title={t("Галерея", "Gallery")}>
      <GalleryContent episodeId={id} inDrawer />
    </SideDrawer>
  );
}
