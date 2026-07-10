"use client";

import { useState } from "react";
import Link from "next/link";
import CopyPackSheet, { type CopyPackRef } from "./CopyPackSheet";

/** Закреплённая нижняя панель действий карточки шота: [Редактор] [Генерировать ▾] [Копи-пак] */
export default function ActionBar({
  episodeId,
  shotId,
  promptText,
  promptVersion,
  promptId,
  copyPackRefs,
  hasPrompt,
}: {
  episodeId: string;
  shotId: string;
  promptText: string;
  promptVersion: number;
  promptId: string;
  copyPackRefs: CopyPackRef[];
  hasPrompt: boolean;
}) {
  const [copyPackOpen, setCopyPackOpen] = useState(false);
  const [stage2Note, setStage2Note] = useState(false);

  const btnBase =
    "flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.1em]";

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg border-t border-[var(--border-default)] md:max-w-3xl"
        style={{
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
        }}
      >
        {stage2Note && (
          <div className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] text-t300">
            Генерация через Higgsfield API — Этап 2. Пока используйте «Копи-пак» + kling.ai.
          </div>
        )}
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
            onClick={() => setStage2Note((v) => !v)}
            className={`${btnBase} border border-transparent bg-violet-800 text-t300`}
            style={{ flex: 1.35 }}
            title="Генерация внутри приложения — Этап 2"
          >
            <span>⚡</span>
            Генерировать ▾
          </button>
          <button
            onClick={() => setCopyPackOpen(true)}
            disabled={!hasPrompt}
            className={`${btnBase} border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400 disabled:opacity-40`}
          >
            <span>⧉</span>
            Копи-пак
          </button>
        </div>
      </div>

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
