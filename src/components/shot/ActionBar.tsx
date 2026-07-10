"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CopyPackSheet, { type CopyPackRef } from "./CopyPackSheet";
import GenerateSheet, { type CatalogModel, type StartFrameOption } from "./GenerateSheet";

/**
 * Панель действий карточки шота: [Редактор] [Генерировать] [Копи-пак].
 * Мобайл — закреплена снизу; десктоп — вертикальная панель справа (без нижних панелей).
 */
export default function ActionBar({
  episodeId,
  shotId,
  promptText,
  promptVersion,
  promptId,
  copyPackRefs,
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
  promptText: string;
  promptVersion: number;
  promptId: string;
  copyPackRefs: CopyPackRef[];
  hasPrompt: boolean;
  models: CatalogModel[];
  defaultModelIds: string[];
  startFrames: StartFrameOption[];
  groupDurationSec: number;
  aspectRatio: string;
  defaultStartFrameId: string | null;
}) {
  const [copyPackOpen, setCopyPackOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  // hotkey G открывает шторку генерации (spec §5)
  useEffect(() => {
    const onOpen = () => hasPrompt && setGenerateOpen(true);
    window.addEventListener("ss:open-generate", onOpen);
    return () => window.removeEventListener("ss:open-generate", onOpen);
  }, [hasPrompt]);

  const editorBtn = (
    <Link
      href={`/episodes/${episodeId}/shots/${shotId}/editor`}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400"
    >
      <span>⌨</span>
      Редактор
    </Link>
  );
  const generateBtn = (
    <button
      onClick={() => setGenerateOpen(true)}
      disabled={!hasPrompt}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40"
      style={{ boxShadow: hasPrompt ? "var(--glow-violet-sm)" : "none" }}
      title={hasPrompt ? "Запустить генерацию Higgsfield" : "Сначала соберите промпт"}
    >
      <span>⚡</span>
      Генерировать
    </button>
  );
  const copyBtn = (
    <button
      onClick={() => setCopyPackOpen(true)}
      disabled={!hasPrompt}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400 disabled:opacity-40"
    >
      <span>⧉</span>
      Копи-пак
    </button>
  );

  return (
    <>
      {/* мобайл — снизу */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg border-t border-[var(--border-default)] md:max-w-3xl lg:hidden"
        style={{
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
        }}
      >
        <div
          className="grid grid-cols-3 gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] [&>*]:min-h-[50px] [&>*]:flex-col"
          style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
        >
          {editorBtn}
          {generateBtn}
          {copyBtn}
        </div>
      </div>

      {/* десктоп — справа */}
      <div
        className="fixed right-0 top-0 z-30 hidden h-full w-[196px] flex-col gap-2 border-l border-[var(--border-default)] p-3 pt-[68px] text-[11px] font-semibold uppercase tracking-[0.08em] lg:flex [&>*]:min-h-[46px]"
        style={{ background: "linear-gradient(180deg, rgba(15,12,22,.6), rgba(6,5,9,.4))" }}
      >
        <div className="section-label mb-1">Действия</div>
        {generateBtn}
        {editorBtn}
        {copyBtn}
      </div>

      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        shotId={shotId}
        promptId={promptId}
        models={models}
        defaultModelIds={defaultModelIds}
        startFrames={startFrames}
        groupDurationSec={groupDurationSec}
        aspectRatio={aspectRatio}
        defaultStartFrameId={defaultStartFrameId}
      />

      <CopyPackSheet
        open={copyPackOpen}
        onClose={() => setCopyPackOpen(false)}
        shotId={shotId}
        promptText={promptText}
        promptVersion={promptVersion}
        promptId={promptId}
        refs={copyPackRefs}
      />
    </>
  );
}
