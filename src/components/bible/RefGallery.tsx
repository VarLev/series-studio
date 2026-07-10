"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { updateReferenceCaption, deleteReference } from "@/lib/actions/entities";

interface GalleryRef {
  id: string;
  url: string;
  caption: string;
  source: string;
}

export default function RefGallery({ refs }: { refs: GalleryRef[] }) {
  const [selected, setSelected] = useState<GalleryRef | null>(null);
  const [caption, setCaption] = useState("");
  const [, startTransition] = useTransition();

  if (!refs.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-3 text-[11px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp; Референсов пока нет. Кадры из ревью
        («взять кадр», Этап 2) тоже будут собираться здесь.
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
            }}
            className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.url} alt={r.caption} className="aspect-square w-full object-cover" />
            {r.caption && (
              <div className="truncate px-1.5 py-1 text-[9px] text-t300">{r.caption}</div>
            )}
          </button>
        ))}
      </div>

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title="Референс">
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
                placeholder="Короткая подпись (например: анфас, тёмная куртка)"
                className="min-h-11 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[12.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <button
                onClick={() => {
                  startTransition(() => updateReferenceCaption(selected.id, caption));
                  setSelected(null);
                }}
                className="min-h-11 rounded-lg bg-violet-500 px-4 text-[11px] font-semibold uppercase text-white"
              >
                Сохранить
              </button>
            </div>
            <button
              onClick={() => {
                startTransition(() => deleteReference(selected.id));
                setSelected(null);
              }}
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
            >
              Удалить референс
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
