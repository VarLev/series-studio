"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { startGeneration } from "@/lib/actions/generate";

export interface CatalogModel {
  id: string;
  name: string;
  credits: number | null;
}

export interface StartFrameOption {
  id: string;
  url: string;
  label: string;
}

/** Шторка «Генерация» (UI TZ §4.3): чекбоксы моделей, start-frame, оценка кредитов. */
export default function GenerateSheet({
  open,
  onClose,
  shotId,
  promptId,
  models,
  defaultModelIds,
  startFrames,
  durationSec,
  aspectRatio,
}: {
  open: boolean;
  onClose: () => void;
  shotId: string;
  promptId: string;
  models: CatalogModel[];
  defaultModelIds: string[];
  startFrames: StartFrameOption[];
  durationSec: number;
  aspectRatio: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultModelIds.filter((id) => models.some((m) => m.id === id))),
  );
  const [startFrame, setStartFrame] = useState<string>("");
  const [confirmInfo, setConfirmInfo] = useState<{ estimate: number; limit: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const estimate = useMemo(
    () =>
      [...selected].reduce((sum, id) => sum + (models.find((m) => m.id === id)?.credits ?? 0), 0),
    [selected, models],
  );
  const hasUnknown = [...selected].some(
    (id) => models.find((m) => m.id === id)?.credits == null,
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmInfo(null);
  }

  function launch(confirmed: boolean) {
    setError("");
    startTransition(async () => {
      const res = await startGeneration({
        shotId,
        promptId,
        modelIds: [...selected],
        startFrameRefId: startFrame || undefined,
        durationSec,
        aspectRatio,
        confirmed,
      });
      if (res.ok) {
        setConfirmInfo(null);
        onClose();
        router.refresh();
      } else if ("needsConfirm" in res && res.needsConfirm) {
        setConfirmInfo({ estimate: res.estimate, limit: res.limit });
      } else if ("error" in res) {
        setError(res.error);
      }
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Генерация · Higgsfield">
      <div className="section-label mb-2">Модели (A/B — отметьте несколько)</div>
      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <label
            key={m.id}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2"
            style={{
              borderColor: selected.has(m.id) ? "var(--border-strong)" : "var(--border-subtle)",
              background: selected.has(m.id) ? "var(--ink-600)" : "none",
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="h-5 w-5 accent-[var(--violet-400)]"
            />
            <span className="flex-1 font-mono text-[12px] font-semibold text-t100">{m.name}</span>
            <span className="font-mono text-[10.5px] text-t400">
              {m.credits != null ? `~${m.credits} кр` : "кредиты: ?"}
            </span>
          </label>
        ))}
        {!models.length && (
          <div className="text-[11.5px] text-t400">
            Каталог моделей пуст — обновите его на экране «Затраты и настройки».
          </div>
        )}
      </div>

      <div className="section-label mb-2 mt-4">Start-frame (image-to-video)</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setStartFrame("")}
          className="flex h-[54px] w-[80px] shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold"
          style={{
            borderColor: !startFrame ? "var(--border-strong)" : "var(--border-subtle)",
            color: !startFrame ? "var(--text-100)" : "var(--text-400)",
            background: !startFrame ? "var(--ink-600)" : "none",
          }}
        >
          Нет
        </button>
        {startFrames.map((f) => (
          <button
            key={f.id}
            onClick={() => setStartFrame(startFrame === f.id ? "" : f.id)}
            className="relative w-[80px] shrink-0"
            title={f.label}
          >
            <span
              className="block h-[54px] overflow-hidden rounded-md border-2"
              style={{
                borderColor: startFrame === f.id ? "var(--warning)" : "var(--border-subtle)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.label} className="h-full w-full object-cover" />
            </span>
            <span className="mt-0.5 block truncate text-left font-mono text-[8.5px] text-t400">
              {f.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5">
        <span className="text-[11px] text-t300">Параметры:</span>
        <span className="font-mono text-[11px] text-t100">
          {durationSec} сек · {aspectRatio}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[12px] font-semibold text-t100">
          ≈ {estimate}
          {hasUnknown ? "+?" : ""} кр
        </span>
      </div>

      {confirmInfo && (
        <div className="mt-3 rounded-lg border border-[rgba(194,71,106,.5)] bg-[rgba(194,71,106,.1)] px-3 py-2.5 text-[12px] leading-relaxed text-[#e08aa4]">
          Оценка ≈{confirmInfo.estimate} кр выше вашего лимита подтверждения ({confirmInfo.limit}{" "}
          кр). Запустить всё равно?
        </div>
      )}
      {error && <div className="mt-3 text-[11.5px] text-danger">{error}</div>}

      <button
        onClick={() => launch(Boolean(confirmInfo))}
        disabled={pending || selected.size === 0}
        className="mt-4 min-h-[52px] w-full rounded-lg text-[12px] font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-50"
        style={{
          background: confirmInfo ? "var(--danger)" : "var(--violet-500)",
          boxShadow: confirmInfo ? "none" : "var(--glow-violet-sm)",
        }}
      >
        {pending
          ? "Отправка…"
          : confirmInfo
            ? `Подтвердить и запустить ${selected.size}`
            : `Запустить ${selected.size} ${selected.size === 1 ? "задачу" : "задачи"}`}
      </button>
    </Sheet>
  );
}
