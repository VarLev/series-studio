"use client";

import { useState } from "react";
import type { Breakdown } from "@/lib/llm/contracts";

type Item = Breakdown["shots"][number] & { included: boolean };

/** Предпросмотр раскадровки: пользователь подтверждает/правит перед созданием карточек. */
export default function BreakdownPreview({
  breakdown,
  replacing,
  onCancel,
  onConfirm,
}: {
  breakdown: Breakdown;
  replacing: boolean;
  onCancel: () => void;
  onConfirm: (confirmed: Breakdown) => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>(
    [...breakdown.shots].sort((a, b) => a.order - b.order).map((s) => ({ ...s, included: true })),
  );
  const [saving, setSaving] = useState(false);

  function patch(i: number, p: Partial<Item>) {
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...p } : item)));
  }

  async function confirm() {
    setSaving(true);
    const confirmed = items
      .filter((i) => i.included)
      .map((item, idx) => ({
        order: idx + 1,
        title: item.title,
        duration_sec: item.duration_sec,
        action: item.action,
        entities: item.entities,
        camera_hint: item.camera_hint,
      }));
    await onConfirm({ shots: confirmed });
    setSaving(false);
  }

  const included = items.filter((i) => i.included).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4 pb-28">
        <div className="mb-3 text-[11px] leading-relaxed text-t400">
          <span className="text-violet-600">✦</span>&nbsp; Claude предложил {items.length} групп.
          Проверьте и поправьте описания — карточки создадутся после подтверждения.
          {replacing && (
            <span className="text-warning"> Существующие шоты и их промпты будут заменены.</span>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3"
              style={{ opacity: item.included ? 1 : 0.45 }}
            >
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={(e) => patch(i, { included: e.target.checked })}
                  className="h-5 w-5 accent-[var(--violet-400)]"
                />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
                  Группа {String(i + 1).padStart(2, "0")} · {item.duration_sec} сек
                </span>
              </div>
              <input
                value={item.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                placeholder="Название группы"
                className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
              />
              <textarea
                value={item.action}
                onChange={(e) => patch(i, { action: e.target.value })}
                rows={3}
                className="w-full resize-y rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {item.entities.map((el) => (
                  <span
                    key={el}
                    className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[10px] text-violet-200"
                  >
                    {el}
                  </span>
                ))}
                {item.camera_hint && (
                  <span className="font-mono text-[10px] text-t400">🎥 {item.camera_hint}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-lg gap-2 border-t border-[var(--border-default)] px-3 py-3 md:max-w-3xl"
        style={{
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <button
          onClick={onCancel}
          className="min-h-[50px] rounded-lg border border-[var(--border-default)] px-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-t200 hover:bg-ink-500"
        >
          Отмена
        </button>
        <button
          onClick={confirm}
          disabled={saving || included === 0}
          className="min-h-[50px] flex-1 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {saving ? "Создание…" : `Создать ${included} карточек`}
        </button>
      </div>
    </div>
  );
}
