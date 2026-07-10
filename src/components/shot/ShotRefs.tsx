"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import UploadButton from "@/components/UploadButton";
import NanoBananaSheet from "@/components/refs/NanoBananaSheet";
import { toast } from "@/components/Toaster";
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

interface PickerRef {
  id: string;
  url: string;
  label: string;
  sub: string;
}

const ROLE_LABEL = { start_frame: "start-frame", composition: "композиция" } as const;

/** Референсы шота (spec §2.3/§3.6): роли, прикрепление из референсов серии/библии, Nano Banana. */
export default function ShotRefs({
  shotId,
  episodeId,
  refs,
  seriesRefs,
  bibleRefs,
  promptText,
}: {
  shotId: string;
  episodeId: string;
  refs: ShotRef[];
  seriesRefs: PickerRef[];
  bibleRefs: PickerRef[];
  promptText: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<ShotRef | null>(null);
  const [nanoOpen, setNanoOpen] = useState(false);
  const [, startTransition] = useTransition();

  function attach(refId: string) {
    startTransition(async () => {
      await attachReferenceToShot(shotId, refId, "composition");
      toast("Референс прикреплён (роль — композиция)");
    });
    setPickerOpen(false);
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {refs.map((r) => (
          <div key={r.id} className="w-[92px] shrink-0">
            <div className="relative h-[54px] overflow-hidden rounded-md border-[1.5px] bg-ink-600"
              style={{
                borderColor: r.role === "start_frame" ? "rgba(192,138,62,.55)" : "var(--border-default)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.caption} className="h-full w-full object-cover" />
              <button
                onClick={() => setRoleFor(r)}
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

      {/* Роль референса (spec §3.6) */}
      <Sheet open={Boolean(roleFor)} onClose={() => setRoleFor(null)} title="Роль референса">
        {roleFor && (
          <div className="flex flex-col gap-1.5 pb-2">
            <button
              onClick={() => {
                startTransition(async () => {
                  await setShotReferenceRole(roleFor.id, "start_frame");
                  toast("Start-frame назначен · прежний стал композицией");
                });
                setRoleFor(null);
              }}
              className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
              style={{
                borderColor: roleFor.role === "start_frame" ? "var(--warning)" : "var(--border-subtle)",
                background: roleFor.role === "start_frame" ? "rgba(192,138,62,.08)" : "none",
              }}
            >
              <span className="text-[12.5px] font-medium text-t100">Start-frame</span>
              <span className="text-[10px] text-t400">
                первый кадр видео · один на шот — прежний станет композицией
              </span>
            </button>
            <button
              onClick={() => {
                startTransition(async () => {
                  await setShotReferenceRole(roleFor.id, "composition");
                  toast("Роль — референс композиции");
                });
                setRoleFor(null);
              }}
              className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
              style={{
                borderColor: roleFor.role === "composition" ? "var(--border-strong)" : "var(--border-subtle)",
                background: roleFor.role === "composition" ? "var(--ink-600)" : "none",
              }}
            >
              <span className="text-[12.5px] font-medium text-t100">Референс композиции</span>
              <span className="text-[10px] text-t400">
                кадрирование / свет / настроение — уходит моделям вместе с промптом
              </span>
            </button>
            <button
              onClick={() => {
                startTransition(async () => {
                  await detachShotReference(roleFor.id);
                  toast("Откреплено от шота · референс остался в серии");
                });
                setRoleFor(null);
              }}
              className="min-h-11 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
            >
              Открепить от шота
            </button>
          </div>
        )}
      </Sheet>

      {/* Прикрепление (spec §2.3): референсы серии + библии, Nano Banana, загрузка */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Прикрепить референс">
        {seriesRefs.length > 0 && (
          <>
            <div className="section-label mb-2">Референсы серии</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {seriesRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="truncate px-1.5 py-1 font-mono text-[9px] text-violet-200">
                    {r.label}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {bibleRefs.length > 0 && (
          <>
            <div className="section-label mb-2">Из библии (сущности шота)</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {bibleRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="truncate px-1.5 py-1 text-[9px] text-t300">{r.label}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {!seriesRefs.length && !bibleRefs.length && (
          <div className="pb-2 text-[12px] text-t400">
            Референсов пока нет — нарисуйте Nano Banana или загрузите файл.
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setPickerOpen(false);
              setNanoOpen(true);
            }}
            className="min-h-11 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            Нарисовать новый · Nano Banana
          </button>
          <UploadButton kind="reference" shotId={shotId} label="Загрузить файл с устройства" />
        </div>
      </Sheet>

      <NanoBananaSheet
        open={nanoOpen}
        onClose={() => setNanoOpen(false)}
        episodeId={episodeId}
        prefillPrompt={promptText}
      />
    </>
  );
}
