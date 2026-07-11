import { requireAuth } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { listTechniques } from "@/lib/director";
import SettingsClient from "@/components/settings/SettingsClient";

export const dynamic = "force-dynamic";

/** Настройки: шаблоны промптов + библиотека режиссёрских приёмов. */
export default async function SettingsPage() {
  await requireAuth();
  const settings = await getAllSettings();
  const techniques = await listTechniques();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <div className="px-4 pb-3 pt-6" style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}>
        <div className="eyebrow mb-1.5">Series Studio</div>
        <h1 className="chrome-text font-display text-[22px] font-bold uppercase leading-tight tracking-[0.06em]">
          Настройки
        </h1>
        <p className="mt-1.5 text-[11px] leading-relaxed text-t400">
          Шаблоны промптов и библиотека режиссёрских приёмов.
        </p>
      </div>
      <SettingsClient
        storyboardTemplate={settings.tpl_storyboard}
        videoTemplate={settings.tpl_video}
        techniques={techniques.map((t) => ({
          id: t.id,
          title: t.title,
          category: t.category,
          camera: t.camera,
          lens: t.lens,
          lighting: t.lighting,
          tags: t.tags,
          prompt: t.prompt,
          negative: t.negative,
          custom: t.custom,
        }))}
      />
    </main>
  );
}
