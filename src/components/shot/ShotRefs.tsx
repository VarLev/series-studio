"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import UploadButton from "@/components/UploadButton";
import {
  attachReferenceToShot,
  detachShotReference,
  setShotReferenceRole,
} from "@/lib/actions/shots";

interface ShotRef {
  id: string;
  url: string;
  caption: string;
  role: "start_frame" | "composition";
}

interface BibleRef {
  id: string;
  url: string;
  caption: string;
  entityName: string;
}

const ROLE_LABEL = { start_frame: "start-frame", composition: "композиция" } as const;

export default function ShotRefs({
  shotId,
  refs,
  bibleRefs,
}: {
  shotId: string;
  refs: ShotRef[];
  bibleRefs: BibleRef[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {refs.map((r) => (
          <div key={r.id} className="w-[92px] shrink-0">
            <div className="relative h-[54px] overflow-hidden rounded-md border-[1.5px] border-[var(--border-default)] bg-ink-600">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.caption} className="h-full w-full object-cover" />
              <button
                onClick={() =>
                  startTransition(() =>
                    setShotReferenceRole(
                      r.id,
                      r.role === "start_frame" ? "composition" : "start_frame",
                    ),
                  )
                }
                className="absolute left-0.5 top-0.5 rounded-[3px] border px-1 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(6,5,9,.8)",
                  color: r.role === "start_frame" ? "var(--warning)" : "var(--violet-200)",
                  borderColor:
                    r.role === "start_frame" ? "rgba(192,138,62,.5)" : "rgba(139,95,176,.5)",
                }}
              >
                {ROLE_LABEL[r.role]}
              </button>
              <button
                aria-label="Убрать референс"
                onClick={() => startTransition(() => detachShotReference(r.id))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-[4px] bg-[rgba(6,5,9,.7)] text-[11px] text-t300 hover:text-danger"
              >
                ×
              </button>
            </div>
            <div className="mt-1 truncate font-mono text-[8.5px] text-t400">
              {r.caption || ROLE_LABEL[r.role]}
            </div>
          </div>
        ))}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex h-[54px] w-[92px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[var(--border-default)] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          <span className="text-[14px] leading-none">+</span>
          <span className="text-[8px] font-medium">из референсов</span>
        </button>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Прикрепить референс">
        <div className="mb-3 text-[11px] text-t400">
          Референсы сущностей этого шота. Тап — прикрепить как композицию (роль меняется тапом по
          бейджу).
        </div>
        <div className="grid grid-cols-3 gap-2">
          {bibleRefs.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                startTransition(() => attachReferenceToShot(shotId, r.id, "composition"));
                setPickerOpen(false);
              }}
              className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" className="aspect-[4/3] w-full object-cover" />
              <div className="truncate px-1.5 py-1 text-[9px] text-t300">
                {r.entityName}
                {r.caption ? ` · ${r.caption}` : ""}
              </div>
            </button>
          ))}
        </div>
        {bibleRefs.length === 0 && (
          <div className="pb-2 text-[12px] text-t400">
            У сущностей шота пока нет референсов — загрузите их в «Библии».
          </div>
        )}
        <div className="mt-3">
          <UploadButton kind="reference" shotId={shotId} label="Загрузить файл с устройства" />
        </div>
      </Sheet>
    </>
  );
}
