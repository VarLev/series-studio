import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, knowledgeDocs } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { SectionLabel } from "@/components/ui";
import SettingsTabs from "@/components/settings/SettingsTabs";
import KnowledgeClient from "@/components/knowledge/KnowledgeClient";
import TemplateEditor from "@/components/settings/TemplateEditor";

/**
 * Тело вкладки «База знаний» — общее для полной страницы (/knowledge) и правой
 * панели (@panel/(.)knowledge). Два раздела, оба — методички промпт-фабрики:
 * документы (свободный текст) и редактируемые шаблоны промптов. Режиссёрские
 * приёмы отсюда переехали в «Базу правил»: приём это инструкция модели, и жить
 * ему рядом с остальными правилами, а не в справочнике.
 */
export default async function KnowledgeContent() {
  await requireAuth();
  const db = await getDb();
  const t = await getT();
  const docs = await db.select().from(knowledgeDocs).orderBy(desc(knowledgeDocs.createdAt));
  const settings = await getAllSettings();

  return (
    <>
      <SettingsTabs />
      <KnowledgeClient
        docs={docs.map((d) => ({
          id: d.id,
          title: d.title,
          sourceFile: d.sourceFile,
          contentMd: d.contentMd,
          tags: d.tags,
          enabled: d.enabled,
        }))}
      />
      <div className="flex flex-col gap-3 px-4 pb-10">
        <SectionLabel
          hint={t("редактируются целиком · правила из них — на /rules", "fully editable · their rules live on /rules")}
        >
          {t("Шаблоны промптов", "Prompt templates")}
        </SectionLabel>
        <TemplateEditor
          settingKey="tpl_breakdown"
          title={t("Шаблон разбивки сюжета на шоты (Claude)", "Story-to-shots breakdown template (Claude)")}
          hint={t(
            "Кнопка «Разбить на группы шотов» на вкладке «Сюжет». Плейсхолдеры: {{STORY}} (или [ВСТАВИТЬ ТЕКСТ]) — литературный сюжет; {{DURATION}} — диапазон хронометража с бегунка на вкладке «Сюжет» (например «3–5 минут»). JSON-формат ответа приложение добавляет само.",
            "The Break into shot groups button on the Story tab. Placeholders: {{STORY}} (or [ВСТАВИТЬ ТЕКСТ]) is the literary story; {{DURATION}} is the duration range from the slider on the Story tab (e.g. “3–5 минут”). The JSON response format is appended automatically.",
          )}
          initial={settings.tpl_breakdown}
        />
        <TemplateEditor
          settingKey="tpl_storyboard"
          title={t("Шаблон раскадровки (Nano Banana)", "Storyboard template (Nano Banana)")}
          hint={t(
            "Плейсхолдеры: {{GRID}}, {{PANELS}}, {{REFERENCES}}, {{STORY}}, {{PANEL_STRUCTURE}} — подставляются при сборке на вкладке «Раскадровка».",
            "Placeholders: {{GRID}}, {{PANELS}}, {{REFERENCES}}, {{STORY}}, {{PANEL_STRUCTURE}} — filled when assembling on the Storyboard tab.",
          )}
          initial={settings.tpl_storyboard}
        />
        <TemplateEditor
          settingKey="tpl_video"
          title={t("Шаблон видео-промпта · Seedance", "Video prompt template · Seedance")}
          hint={t(
            "Инструкция промпт-фабрики для трека Seedance (референсы @Image1/@Start, без нативного звука). Кнопка «Сгенерировать промпт» на карточке шота.",
            "Prompt-factory instruction for the Seedance track (@Image1/@Start references, no native audio). The Generate prompt button on the shot card.",
          )}
          initial={settings.tpl_video}
        />
        <TemplateEditor
          settingKey="tpl_video_kling"
          title={t("Шаблон видео-промпта · Kling", "Video prompt template · Kling")}
          hint={t(
            "Инструкция промпт-фабрики для трека Kling 3.0 Omni: референсы <<<image_N>>>, нативный звук (реплики в кавычках, эмбиент, SFX), структура «сцена → персонаж → камера → действие → реплика → аудио».",
            "Prompt-factory instruction for the Kling 3.0 Omni track: <<<image_N>>> references, native audio (quoted dialogue, ambience, SFX), “scene → character → camera → action → dialogue → audio” structure.",
          )}
          initial={settings.tpl_video_kling}
        />
      </div>
    </>
  );
}
