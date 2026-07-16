import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { ScreenHeader } from "@/components/ui";
import { getT } from "@/lib/i18n-server";
import EntityContent, { entityName } from "./EntityContent";

export const dynamic = "force-dynamic";

/**
 * Полная страница сущности — только по прямому URL/перезагрузке. Внутри
 * приложения этот маршрут перехватывается правой панелью
 * (@panel/(.)bible/[entityId]), в том числе при переходе из списка библии,
 * который сам открыт панелью.
 */
export default async function EntityPage(ctx: { params: Promise<{ entityId: string }> }) {
  await requireAuth();
  const { entityId } = await ctx.params;
  const name = await entityName(entityId);
  if (!name) notFound();
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/bible" eyebrow={t("Библия", "Bible")} title={name} />
      <EntityContent entityId={entityId} />
    </main>
  );
}
