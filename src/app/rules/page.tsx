import { requireAuth } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import {
  getDisabledRuleIds,
  listTemplateRules,
  listUserRules,
  templateRulesStatus,
} from "@/lib/rules";
import RulesClient from "@/components/rules/RulesClient";
import SettingsHeader from "@/components/settings/SettingsHeader";
import SettingsTabs from "@/components/settings/SettingsTabs";

export const dynamic = "force-dynamic";

/**
 * «База правил»: все инструкции, которые уходят моделям — пользовательские
 * правила (CRUD), системные правила и динамические блоки реестра (вкл/выкл),
 * правила, извлечённые из редактируемых шаблонов (read-only витрина).
 */
export default async function RulesPage() {
  await requireAuth();
  const [disabled, userRules, templateRules, templateStatus] = await Promise.all([
    getDisabledRuleIds(),
    listUserRules(),
    listTemplateRules(),
    templateRulesStatus(),
  ]);
  const t = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <SettingsHeader
        title={t("База правил", "Rules")}
        subtitle={t(
          "Все инструкции, которые уходят моделям: свои правила, системные правила, программные блоки и правила из шаблонов.",
          "Every instruction sent to the models: your rules, system rules, dynamic blocks and template-derived rules.",
        )}
      />
      <SettingsTabs />
      <RulesClient
        disabledIds={[...disabled]}
        userRules={userRules.map((r) => ({
          id: r.id,
          title: r.title,
          text: r.text,
          scope: r.scope,
          family: r.family,
          enabled: r.enabled,
        }))}
        templateRules={templateRules.map((r) => ({
          id: r.id,
          templateKey: r.templateKey,
          title: r.title,
          text: r.text,
        }))}
        templateStatus={templateStatus}
      />
    </main>
  );
}
