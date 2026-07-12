"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { updateReferenceCaption, deleteReference, setReferenceFace } from "@/lib/actions/entities";
import { useT } from "@/components/I18nProvider";

interface GalleryRef {
  id: string;
  url: string;
  caption: string;
  source: string;
  /** «только лицо»: одежду с этого референса не якорить */
  faceOnly?: boolean;
}

export default function RefGallery({ refs }: { refs: GalleryRef[] }) {
  const t = useT();
  const [selected, setSelected] = useState<GalleryRef | null>(null);
  const [caption, setCaption] = useState("");
  const [faceOnly, setFaceOnly] = useState(false);
  const [, startTransition] = useTransition();

  if (!refs.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-3 text-[11px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp;{" "}
        {t(
          "Референсов пока нет. Кадры из ревью («взять кадр») тоже будут собираться здесь.",
          "No references yet. Frames grabbed in review also collect here.",
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {refs.map((r) => (
          <button
            key={r.id}
            onClick={() => {
              setSelected(r);
              setCaption(r.caption);
              setFaceOnly(Boolean(r.faceOnly));
            }}
            className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.url} alt={r.caption} loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
            {r.faceOnly && (
              <span className="absolute right-1 top-1 rounded bg-[rgba(6,5,9,.8)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-warning">
                {t("лицо", "face")}
              </span>
            )}
            {r.caption && (
              <div className="truncate px-1.5 py-1 text-[9px] text-t300">{r.caption}</div>
            )}
          </button>
        ))}
      </div>

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title={t("Референс", "Reference")}>
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.url}
              alt=""
              className="max-h-[50dvh] w-full rounded-lg border border-[var(--border-subtle)] object-contain"
              style={{ background: "#000" }}
            />
            <div className="flex gap-2">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={t("Короткая подпись (например: анфас, тёмная куртка)", "Short caption (e.g. front view, dark jacket)")}
                className="min-h-11 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[12.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <button
                onClick={() => {
                  startTransition(() => updateReferenceCaption(selected.id, caption));
                  setSelected(null);
                }}
                className="min-h-11 rounded-lg bg-violet-500 px-4 text-[11px] font-semibold uppercase text-white"
              >
                {t("Сохранить", "Save")}
              </button>
            </div>
            {/* «только лицо»: с этого референса нельзя зафиксировать одежду —
                промпт-фабрика добавит "face/identity only" для персонажа */}
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] px-3">
              <input
                type="checkbox"
                checked={faceOnly}
                onChange={(e) => {
                  setFaceOnly(e.target.checked);
                  startTransition(() => setReferenceFace(selected.id, e.target.checked));
                }}
                className="h-4 w-4 accent-[var(--violet-400)]"
              />
              <span className="text-[12px] text-t200">
                {t("Только лицо (одежду не якорить)", "Face only (don't anchor clothing)")}
              </span>
            </label>
            <button
              onClick={() => {
                startTransition(() => deleteReference(selected.id));
                setSelected(null);
              }}
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
            >
              {t("Удалить референс", "Delete reference")}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
