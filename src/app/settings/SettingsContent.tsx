import { requireAuth } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { isConnected } from "@/lib/higgsfieldMcp";
import { isConnected as isKlingConnected } from "@/lib/klingMcp";
import SettingsClient from "@/components/settings/SettingsClient";
import SettingsTabs from "@/components/settings/SettingsTabs";

/**
 * Тело «Настроек» без экранной обвязки — общее для полной страницы (/settings)
 * и для правой панели (@panel/(.)settings). Подвкладка «Затраты» (/costs) тоже
 * перехвачена, поэтому переключение вкладок остаётся внутри панели.
 */
export default async function SettingsContent() {
  await requireAuth();
  const settings = await getAllSettings();
  const hfConnected = await isConnected();
  const klingConnected = await isKlingConnected();

  return (
    <>
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
      />
    </>
  );
}
