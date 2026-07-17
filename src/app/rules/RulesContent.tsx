import { requireAuth } from "@/lib/auth";
import { listTechniques, techniquesEnabled } from "@/lib/director";
import {
  getDisabledRuleIds,
  listTemplateRules,
  listUserRules,
  templateRulesStatus,
} from "@/lib/rules";
import RulesClient from "@/components/rules/RulesClient";
import SettingsTabs from "@/components/settings/SettingsTabs";

/**
 * Тело «Базы правил» без экранной обвязки — общее для полной страницы (/rules)
 * и правой панели (@panel/(.)rules). Всё, что уходит моделям инструкцией: свои
 * правила, реестр системных правил и динамических блоков, витрина правил из
 * шаблонов и библиотека режиссёрских приёмов.
 */
export default async function RulesContent() {
  await requireAuth();
  const [disabled, userRules, templateRules, templateStatus, techniques, techEnabled] =
    await Promise.all([
      getDisabledRuleIds(),
      listUserRules(),
      listTemplateRules(),
      templateRulesStatus(),
      listTechniques(),
      techniquesEnabled(),
    ]);

  return (
    <>
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
        techniquesEnabled={techEnabled}
        techniques={techniques.map((tq) => ({
          id: tq.id,
          title: tq.title,
          category: tq.category,
          camera: tq.camera,
          lens: tq.lens,
          lighting: tq.lighting,
          tags: tq.tags,
          prompt: tq.prompt,
          negative: tq.negative,
          custom: tq.custom,
        }))}
      />
    </>
  );
}
