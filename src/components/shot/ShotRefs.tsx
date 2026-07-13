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
import { useT } from "@/components/I18nProvider";
import type { ImageModelMeta } from "@/lib/imageModels";

interface ShotRef {
  id: string;
  url: string;
  caption: string;
  role: "start_frame" | "composition";
  /** якорь в тексте промпта: @Start | @Comp1..N — связь картинки с промптом */
  anchor: string;
}

interface PickerRef {
  id: string;
  url: string;
  label: string;
  sub: string;
}

const ROLE_LABEL = {
  start_frame: { ru: "start-frame", en: "start-frame" },
  composition: { ru: "композиция", en: "composition" },
} as const;

/** Референсы шота (spec §2.3/§3.6): роли, прикрепление из референсов серии/библии, Nano Banana. */
export default function ShotRefs({
  shotId,
  episodeId,
  refs,
  seriesRefs,
  bibleRefs,
  promptText,
  imageModels = [],
}: {
  shotId: string;
  episodeId: string;
  refs: ShotRef[];
  seriesRefs: PickerRef[];
  bibleRefs: PickerRef[];
  promptText: string;
  imageModels?: ImageModelMeta[];
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<ShotRef | null>(null);
  const [nanoOpen, setNanoOpen] = useState(false);
  const [, startTransition] = useTransition();
  const roleLabel = (role: keyof typeof ROLE_LABEL) => t(ROLE_LABEL[role].ru, ROLE_LABEL[role].en);

  function attach(refId: string) {
    startTransition(async () => {
      await attachReferenceToShot(shotId, refId, "composition");
      toast(t("Референс прикреплён (роль — композиция)", "Reference attached (role — composition)"));
    });
    setPickerOpen(false);
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {refs.map((r) => (
          <div key={r.id} className="w-[58px] shrink-0">
            <div className="relative aspect-[9/16] overflow-hidden rounded-md border-[1.5px] bg-ink-600"
              style={{
                borderColor: r.role === "start_frame" ? "rgba(192,138,62,.55)" : "var(--border-default)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.caption} loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
                {roleLabel(r.role)}
              </button>
            </div>
            <div className="mt-1 truncate font-mono text-[8.5px] text-t400">
              {/* якорь = имя референса в тексте промпта (@Comp1 / @Start) */}
              {r.anchor && <span className="font-semibold text-violet-200">{r.anchor}</span>}
              {r.anchor && r.caption ? " · " : ""}
              {r.caption || (!r.anchor ? roleLabel(r.role) : "")}
            </div>
          </div>
        ))}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex aspect-[9/16] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[var(--border-default)] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          <span className="text-[14px] leading-none">+</span>
          <span className="text-[8px] font-medium">{t("из референсов", "from references")}</span>
        </button>
      </div>

      {/* Роль референса (spec §3.6) */}
      <Sheet open={Boolean(roleFor)} onClose={() => setRoleFor(null)} title={t("Роль референса", "Reference role")}>
        {roleFor && (
          <div className="flex flex-col gap-1.5 pb-2">
            <button
              onClick={() => {
                startTransition(async () => {
                  await setShotReferenceRole(roleFor.id, "start_frame");
                  toast(t("Start-frame назначен · прежний стал композицией", "Start-frame set · the previous one became composition"));
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
                {t(
                  "первый кадр видео · один на шот — прежний станет композицией",
                  "first frame of the video · one per shot — the previous one becomes composition",
                )}
              </span>
            </button>
            <button
              onClick={() => {
                startTransition(async () => {
                  await setShotReferenceRole(roleFor.id, "composition");
                  toast(t("Роль — референс композиции", "Role — composition reference"));
                });
                setRoleFor(null);
              }}
              className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
              style={{
                borderColor: roleFor.role === "composition" ? "var(--border-strong)" : "var(--border-subtle)",
                background: roleFor.role === "composition" ? "var(--ink-600)" : "none",
              }}
            >
              <span className="text-[12.5px] font-medium text-t100">
                {t("Референс композиции", "Composition reference")}
              </span>
              <span className="text-[10px] text-t400">
                {t(
                  "кадрирование / свет / настроение — уходит моделям вместе с промптом",
                  "framing / light / mood — sent to the models along with the prompt",
                )}
              </span>
            </button>
            <button
              onClick={() => {
                startTransition(async () => {
                  await detachShotReference(roleFor.id);
                  toast(t("Откреплено от шота · референс остался в серии", "Detached from shot · reference stays in the episode"));
                });
                setRoleFor(null);
              }}
              className="min-h-11 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
            >
              {t("Открепить от шота", "Detach from shot")}
            </button>
          </div>
        )}
      </Sheet>

      {/* Прикрепление (spec §2.3): референсы серии + библии, Nano Banana, загрузка */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t("Прикрепить референс", "Attach reference")}>
        {seriesRefs.length > 0 && (
          <>
            <div className="section-label mb-2">{t("Референсы серии", "Episode references")}</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {seriesRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
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
            <div className="section-label mb-2">{t("Из библии (сущности шота)", "From the bible (shot entities)")}</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {bibleRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
                  <div className="truncate px-1.5 py-1 text-[9px] text-t300">{r.label}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {!seriesRefs.length && !bibleRefs.length && (
          <div className="pb-2 text-[12px] text-t400">
            {t(
              "Референсов пока нет — нарисуйте Nano Banana или загрузите файл.",
              "No references yet — draw one with Nano Banana or upload a file.",
            )}
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
            {t("Нарисовать новый · Nano Banana", "Draw new · Nano Banana")}
          </button>
          <UploadButton kind="reference" shotId={shotId} label={t("Загрузить файл с устройства", "Upload a file from device")} />
        </div>
      </Sheet>

      <NanoBananaSheet
        open={nanoOpen}
        onClose={() => setNanoOpen(false)}
        episodeId={episodeId}
        prefillPrompt={promptText}
        models={imageModels}
      />
    </>
  );
}
