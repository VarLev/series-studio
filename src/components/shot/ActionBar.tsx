"use client";

import { useEffect, useState } from "react";
import GenerateSheet, { type CatalogModel, type StartFrameOption } from "./GenerateSheet";
import type { PromptFamily } from "@/lib/llm/models";
import { useT } from "@/components/I18nProvider";

/**
 * Панель действий карточки шота: [Генерировать] (правка промпта — кнопкой ✎ в
 * блоке промпта; «Копи-пак» убран — больше не актуален, замечание заказчика).
 * Мобайл — закреплена НАД общим таб-баром (он теперь на всех экранах);
 * десктоп — вертикальная панель справа.
 */
export default function ActionBar({
  shotId,
  promptFamilies,
  hasPrompt,
  models,
  defaultModelIds,
  startFrames,
  groupDurationSec,
  aspectRatio,
  defaultStartFrameId,
}: {
  episodeId: string;
  shotId: string;
  /** какие промпт-треки существуют (гейтинг моделей в шторке генерации) */
  promptFamilies: Record<PromptFamily, boolean>;
  hasPrompt: boolean;
  models: CatalogModel[];
  defaultModelIds: string[];
  startFrames: StartFrameOption[];
  groupDurationSec: number;
  aspectRatio: string;
  defaultStartFrameId: string | null;
}) {
  const t = useT();
  const [generateOpen, setGenerateOpen] = useState(false);

  // hotkey G открывает шторку генерации (spec §5)
  useEffect(() => {
    const onOpen = () => hasPrompt && setGenerateOpen(true);
    window.addEventListener("ss:open-generate", onOpen);
    return () => window.removeEventListener("ss:open-generate", onOpen);
  }, [hasPrompt]);

  const generateBtn = (
    <button
      onClick={() => setGenerateOpen(true)}
      disabled={!hasPrompt}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40"
      style={{ boxShadow: hasPrompt ? "var(--glow-violet-sm)" : "none" }}
      title={hasPrompt ? t("Запустить генерацию Higgsfield", "Start Higgsfield generation") : t("Сначала соберите промпт", "Build a prompt first")}
    >
      <span>⚡</span>
      {t("Генерировать", "Generate")}
    </button>
  );

  return (
    <>
      {/* мобайл — над таб-баром (58px + safe-area, см. NavClient) */}
      <div
        className="fixed inset-x-0 z-30 mx-auto w-full max-w-lg border-t border-[var(--border-default)] md:max-w-3xl lg:hidden"
        style={{
          bottom: "calc(58px + env(safe-area-inset-bottom))",
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="grid grid-cols-1 gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] [&>*]:min-h-[50px] [&>*]:flex-col">
          {generateBtn}
        </div>
      </div>

      {/* десктоп — справа */}
      <div
        className="fixed right-0 top-0 z-30 hidden h-full w-[196px] flex-col gap-2 border-l border-[var(--border-default)] p-3 pt-[68px] text-[11px] font-semibold uppercase tracking-[0.08em] lg:flex [&>*]:min-h-[46px]"
        style={{ background: "linear-gradient(180deg, rgba(15,12,22,.6), rgba(6,5,9,.4))" }}
      >
        <div className="section-label mb-1">{t("Действия", "Actions")}</div>
        {generateBtn}
      </div>

      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        shotId={shotId}
        promptFamilies={promptFamilies}
        models={models}
        defaultModelIds={defaultModelIds}
        startFrames={startFrames}
        groupDurationSec={groupDurationSec}
        aspectRatio={aspectRatio}
        defaultStartFrameId={defaultStartFrameId}
      />
    </>
  );
}
