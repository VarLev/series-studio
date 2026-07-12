import { requireAuth } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { listTechniques } from "@/lib/director";
import { isConnected } from "@/lib/higgsfieldMcp";
import { isConnected as isKlingConnected } from "@/lib/klingMcp";
import SettingsClient from "@/components/settings/SettingsClient";
import SettingsTabs from "@/components/settings/SettingsTabs";
import SettingsHeader from "@/components/settings/SettingsHeader";

export const dynamic = "force-dynamic";

/** Настройки: интерфейс, шаблоны промптов, библиотека режиссёрских приёмов. */
export default async function SettingsPage() {
  await requireAuth();
  const settings = await getAllSettings();
  const techniques = await listTechniques();
  const hfConnected = await isConnected();
  const klingConnected = await isKlingConnected();
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <SettingsHeader
        title={t("Настройки", "Settings")}
        subtitle={t(
          "Язык и стиль, шаблоны промптов, библиотека режиссёрских приёмов.",
          "Language & style, prompt templates, director technique library.",
        )}
      />
      <SettingsTabs />
      <SettingsClient
        uiLang={settings.ui_lang}
        uiTheme={settings.ui_theme}
        simpleModel={settings.llm_simple_model}
        hfConnected={hfConnected}
        klingConnected={klingConnected}
        breakdownTemplate={settings.tpl_breakdown}
        storyboardTemplate={settings.tpl_storyboard}
        videoTemplate={settings.tpl_video}
        klingVideoTemplate={settings.tpl_video_kling}
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
