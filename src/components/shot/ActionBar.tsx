"use client";

import { useEffect, useState } from "react";
import GenerateSheet, { type CatalogModel, type StartFrameOption } from "./GenerateSheet";
import type { PromptFamily } from "@/lib/llm/models";
import { useT } from "@/components/I18nProvider";

/**
 * Действия карточки шота: [Генерировать] (правка промпта — кнопкой ✎ в
 * блоке промпта; «Копи-пак» убран — больше не актуален, замечание заказчика).
 * Мобайл — круглый FAB справа внизу по общему FAB-контракту: 56px, right 16px,
 * bottom = таб-бар 58px + safe-area + 16px; FAB «Промпт» (PromptDrawer) стоит
 * НАД ним (+84px). Десктоп — вертикальная панель справа.
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
      {/* мобайл — круглый FAB над таб-баром (FAB-контракт, см. коммент выше) */}
      <button
        onClick={() => setGenerateOpen(true)}
        disabled={!hasPrompt}
        aria-label={t("Генерировать", "Generate")}
        title={hasPrompt ? t("Запустить генерацию Higgsfield", "Start Higgsfield generation") : t("Сначала соберите промпт", "Build a prompt first")}
        className="fixed z-30 flex h-14 w-14 items-center justify-center rounded-full bg-violet-500 text-[22px] text-white hover:bg-violet-400 disabled:opacity-40 lg:hidden"
        style={{
          right: "16px",
          bottom: "calc(58px + env(safe-area-inset-bottom) + 16px)",
          boxShadow: hasPrompt ? "var(--glow-violet-sm)" : "none",
        }}
      >
        ⚡
      </button>

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
