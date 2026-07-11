"use client";

/**
 * Референсы серии (spec §2.6): сетка с токенами, детальный просмотр,
 * Upscale ×2, правка с доп. референсами, «+ Nano Banana».
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import UploadButton from "@/components/UploadButton";
import NanoBananaSheet from "./NanoBananaSheet";
import { toast } from "@/components/Toaster";
import { upscaleReference, editReference } from "@/lib/actions/generate";
import { deleteReference, updateReferenceCaption } from "@/lib/actions/entities";
import { deleteAllSeriesRefs } from "@/lib/actions/deletes";
import { EmptyState } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";

export interface SeriesRef {
  id: string;
  url: string;
  token: string;
  caption: string;
  source: string;
  width: number | null;
  height: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "загрузка",
  "frame-grab": "кадр из ревью",
  "nano-banana": "Nano Banana",
  upscale: "upscale",
  edit: "правка",
  storyboard: "лист раскадровки",
  "storyboard-frame": "кадр раскадровки",
};

const KNOWN_ASPECTS: Array<[string, number]> = [
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["21:9", 21 / 9],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["4:5", 4 / 5],
  ["5:4", 5 / 4],
];

/** «Прилипает» к ближайшему стандартному соотношению (±3%) — 1080×1920 это 9:16, а не 0.56. */
function aspectLabel(w: number | null, h: number | null): string {
  if (!w || !h) return "—";
  const ratio = w / h;
  for (const [label, value] of KNOWN_ASPECTS) {
    if (Math.abs(ratio - value) / value < 0.03) return label;
  }
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  const rw = w / d;
  const rh = h / d;
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  return ratio.toFixed(2);
}

export default function SeriesRefs({
  episodeId,
  refs,
  pendingJobs,
}: {
  episodeId: string;
  refs: SeriesRef[];
  pendingJobs: Array<{ id: string; model: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SeriesRef | null>(null);
  const [nanoOpen, setNanoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [extraRefs, setExtraRefs] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [pending, startTransition] = useTransition();

  function openDetail(ref: SeriesRef) {
    setSelected(ref);
    setCaption(ref.caption);
    setEditOpen(false);
  }

  function doUpscale() {
    if (!selected) return;
    startTransition(async () => {
      const res = await upscaleReference(selected.id);
      toast(res.ok ? "Upscale ×2 поставлен · Nano Banana · 4 кр" : ("error" in res && res.error) || "Ошибка");
      if (res.ok) {
        setSelected(null);
        router.refresh();
      }
    });
  }

  function doEdit() {
    if (!selected || !editPrompt.trim()) return;
    startTransition(async () => {
      const res = await editReference({
        refId: selected.id,
        prompt: editPrompt.trim(),
        extraRefIds: extraRefs,
      });
      toast(res.ok ? "Правка поставлена · ≈6 кр · исходник не тронут" : ("error" in res && res.error) || "Ошибка");
      if (res.ok) {
        setEditOpen(false);
        setSelected(null);
        setEditPrompt("");
        setExtraRefs([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4 pb-10">
      <div className="flex items-center gap-2">
        <span className="text-[11px] leading-relaxed text-t400">
          <span className="text-violet-600">✦</span>&nbsp; Кадры из ревью и картинки Nano Banana
          собираются здесь. Токены REF_NN работают в @-упоминаниях редактора.
        </span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setNanoOpen(true)}
          className="min-h-11 flex-1 rounded-lg bg-violet-500 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          + Nano Banana
        </button>
        <UploadButton
          kind="reference"
          episodeId={episodeId}
          label="+ С устройства"
          className="min-h-11 flex-1 rounded-lg border-[1.5px] border-dashed border-[var(--border-default)] px-3 text-[11px] font-semibold text-t200 hover:border-[var(--border-strong)]"
        />
      </div>

      {refs.length === 0 && pendingJobs.length === 0 && (
        <EmptyState>
          Пока пусто. Возьмите кадр в ревью, нарисуйте референс Nano Banana или загрузите файл.
        </EmptyState>
      )}

      <div className="grid grid-cols-3 gap-2">
        {pendingJobs.map((job) => (
          <div
            key={job.id}
            className="flex aspect-[9/16] flex-col items-center justify-center gap-1.5 rounded-lg border border-[rgba(192,138,62,.35)]"
            style={{
              background:
                "repeating-linear-gradient(135deg, var(--ink-700) 0 12px, var(--ink-600) 12px 24px)",
            }}
          >
            <span className="pulse-amber h-2 w-2 rounded-full bg-warning" />
            <span className="font-mono text-[9px] text-t400">{job.model}</span>
          </div>
        ))}
        {refs.map((r) => (
          <button
            key={r.id}
            onClick={() => openDetail(r)}
            className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-700 text-left hover:border-[var(--border-strong)]"
          >
            <span className="relative block aspect-[9/16] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.token} className="h-full w-full object-cover" />
              <span className="absolute right-1 top-1 rounded bg-[rgba(6,5,9,.75)] px-1 py-0.5 font-mono text-[8px] text-t100">
                {aspectLabel(r.width, r.height)}
              </span>
            </span>
            <span className="flex items-center gap-1 px-1.5 py-1">
              <span className="font-mono text-[9px] font-semibold text-violet-200">{r.token}</span>
              <span className="min-w-0 flex-1 truncate text-[8.5px] text-t400">
                {r.caption || SOURCE_LABEL[r.source] || r.source}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Детальный просмотр */}
      <Sheet open={Boolean(selected) && !editOpen} onClose={() => setSelected(null)} title={selected?.token || "Референс"}>
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.url}
              alt=""
              className="max-h-[45dvh] w-full rounded-lg border border-[var(--border-subtle)] object-contain"
              style={{ background: "#000" }}
            />
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[10px] text-t100">
                {aspectLabel(selected.width, selected.height)}
              </span>
              {selected.width && selected.height && (
                <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[10px] text-t100">
                  {selected.width}×{selected.height}
                </span>
              )}
              <span className="rounded px-2 py-1 font-mono text-[10px] text-t400">
                {SOURCE_LABEL[selected.source] || selected.source}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Подпись"
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <button
                onClick={() =>
                  startTransition(async () => {
                    await updateReferenceCaption(selected.id, caption);
                    toast("Подпись сохранена");
                    router.refresh();
                  })
                }
                className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-[10.5px] font-semibold text-t200"
              >
                ✓
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={doUpscale}
                disabled={pending}
                className="flex min-h-[50px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border-default)] bg-ink-500 text-t100 hover:bg-ink-400 disabled:opacity-50"
              >
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
                  Upscale ×2
                </span>
                <span className="font-mono text-[9px] text-t400">Nano Banana · 4 кр</span>
              </button>
              <button
                onClick={() => {
                  setEditOpen(true);
                  setEditPrompt("");
                  setExtraRefs([]);
                }}
                disabled={pending}
                className="flex min-h-[50px] flex-[1.3] flex-col items-center justify-center gap-0.5 rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50"
                style={{ boxShadow: "var(--glow-violet-sm)" }}
              >
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
                  Редактировать
                </span>
                <span className="font-mono text-[9px] text-white/70">Nano Banana · промпт</span>
              </button>
            </div>
            <button
              onClick={() =>
                startTransition(async () => {
                  await deleteReference(selected.id);
                  toast("Референс удалён");
                  setSelected(null);
                  router.refresh();
                })
              }
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
            >
              Удалить
            </button>
          </div>
        )}
      </Sheet>

      {/* Правка (spec §2.6) */}
      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title={`Правка ${selected?.token ?? ""} · ≈6 кр`}>
        <div className="flex flex-col gap-3 pb-2">
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Что изменить? («убери прожектор, добавь дождь…») Соотношение сторон сохранится, исходник не тронется."
            className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <div className="section-label">Доп. референсы (по желанию)</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {refs
              .filter((r) => r.id !== selected?.id)
              .map((r) => {
                const on = extraRefs.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      setExtraRefs((prev) =>
                        on ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                      )
                    }
                    className="w-[48px] shrink-0"
                  >
                    <span
                      className="block aspect-[9/16] overflow-hidden rounded-md border-2"
                      style={{ borderColor: on ? "var(--violet-400)" : "var(--border-subtle)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="h-full w-full object-cover" />
                    </span>
                    <span className="mt-0.5 block truncate text-center font-mono text-[8px] text-t400">
                      {r.token}
                    </span>
                  </button>
                );
              })}
          </div>
          <button
            onClick={doEdit}
            disabled={pending || !editPrompt.trim()}
            className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {pending ? "Отправка…" : "Создать правку (новый референс)"}
          </button>
        </div>
      </Sheet>

      {refs.length > 1 && (
        <ConfirmButton
          action={deleteAllSeriesRefs.bind(null, episodeId)}
          label={`Удалить все референсы (${refs.length})`}
          confirmLabel="Точно удалить все референсы серии?"
          doneToast="Референсы удалены"
          className="mt-1 min-h-11 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
        />
      )}

      <NanoBananaSheet
        open={nanoOpen}
        onClose={() => setNanoOpen(false)}
        episodeId={episodeId}
      />
    </div>
  );
}
