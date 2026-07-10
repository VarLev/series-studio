"use client";

import { useState } from "react";
import Link from "next/link";
import CopyPackSheet, { type CopyPackRef } from "./CopyPackSheet";
import GenerateSheet, { type CatalogModel, type StartFrameOption } from "./GenerateSheet";

/** Закреплённая нижняя панель действий карточки шота: [Редактор] [Генерировать ▾] [Копи-пак] */
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
  durationSec,
  aspectRatio,
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
  durationSec: number;
  aspectRatio: string;
}) {
  const [copyPackOpen, setCopyPackOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const btnBase =
    "flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.1em] disabled:opacity-40";

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg border-t border-[var(--border-default)] md:max-w-3xl"
        style={{
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
        }}
      >
        <div
          className="flex gap-2 px-3 py-2.5"
          style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
        >
          <Link
            href={`/episodes/${episodeId}/shots/${shotId}/editor`}
            className={`${btnBase} border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400`}
          >
            <span>⌨</span>
            Редактор
          </Link>
          <button
            onClick={() => setGenerateOpen(true)}
            disabled={!hasPrompt}
            className={`${btnBase} bg-violet-500 text-white hover:bg-violet-400`}
            style={{ flex: 1.35, boxShadow: hasPrompt ? "var(--glow-violet-sm)" : "none" }}
            title={hasPrompt ? "Запустить генерацию Higgsfield" : "Сначала соберите промпт"}
          >
            <span>⚡</span>
            Генерировать ▾
          </button>
          <button
            onClick={() => setCopyPackOpen(true)}
            disabled={!hasPrompt}
            className={`${btnBase} border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400`}
          >
            <span>⧉</span>
            Копи-пак
          </button>
        </div>
      </div>

      <GenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        shotId={shotId}
        promptId={promptId}
        models={models}
        defaultModelIds={defaultModelIds}
        startFrames={startFrames}
        durationSec={durationSec}
        aspectRatio={aspectRatio}
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
