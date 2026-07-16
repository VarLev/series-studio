import { desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, knowledgeDocs } from "@/lib/db";
import { listTechniques, techniquesEnabled } from "@/lib/director";
import { getT } from "@/lib/i18n-server";
import { SectionLabel } from "@/components/ui";
import SettingsTabs from "@/components/settings/SettingsTabs";
import KnowledgeClient from "@/components/knowledge/KnowledgeClient";
import TechniquesLibrary from "@/components/knowledge/TechniquesLibrary";

/**
 * Тело вкладки «База знаний» — общее для полной страницы (/knowledge) и правой
 * панели (@panel/(.)knowledge). Два раздела, оба — методички промпт-фабрики:
 * документы (свободный текст) и режиссёрские приёмы (структурированные карточки).
 * Данные читает с сервера; интерактивность — в клиентских компонентах.
 */
export default async function KnowledgeContent() {
  await requireAuth();
  const db = await getDb();
  const t = await getT();
  const docs = await db.select().from(knowledgeDocs).orderBy(desc(knowledgeDocs.createdAt));
  const techniques = await listTechniques();
  const techEnabled = await techniquesEnabled();

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
        <SectionLabel hint={t("камера и оптика · закрепляются за шотом", "camera & optics · attached to a shot")}>
          {t("Режиссёрские приёмы", "Director techniques")}
        </SectionLabel>
        <TechniquesLibrary
          enabled={techEnabled}
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
      </div>
    </>
  );
}
