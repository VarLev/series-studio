"use client";

import { useMemo, useState } from "react";
import type { Breakdown } from "@/lib/llm/contracts";
import { useT } from "@/components/I18nProvider";

type Item = Breakdown["shots"][number] & { included: boolean; duplicate: boolean };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\wа-яё]+/gi, " ").trim();
}

/**
 * Предпросмотр раскадровки: пользователь подтверждает/правит перед созданием карточек.
 * Spec §2.2: повторный запуск не дублирует готовые группы — похожие на существующие
 * помечаются и по умолчанию выключены; новые добавляются после существующих.
 */
export default function BreakdownPreview({
  breakdown,
  existingTitles,
  onCancel,
  onConfirm,
  onEdited,
}: {
  breakdown: Breakdown;
  existingTitles: string[];
  onCancel: () => void;
  onConfirm: (confirmed: Breakdown, mode: "append" | "replace") => Promise<void>;
  /** Правки полей предпросмотра — родитель сохраняет их (localStorage), чтобы не терять. */
  onEdited?: (b: Breakdown) => void;
}) {
  const t = useT();
  const existing = useMemo(() => new Set(existingTitles.map(normalize).filter(Boolean)), [existingTitles]);
  const hasExisting = existingTitles.length > 0;
  const [mode, setMode] = useState<"append" | "replace">(hasExisting ? "append" : "replace");
  const [items, setItems] = useState<Item[]>(() =>
    [...breakdown.shots]
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const duplicate = hasExisting && existing.has(normalize(s.title));
        return { ...s, duplicate, included: !duplicate };
      }),
  );
  const [saving, setSaving] = useState(false);

  function patch(i: number, p: Partial<Item>) {
    const next = items.map((item, idx) => (idx === i ? { ...item, ...p } : item));
    setItems(next);
    onEdited?.({
      shots: next.map((item) => ({
        order: item.order,
        title: item.title,
        duration_sec: item.duration_sec,
        action: item.action,
        entities: item.entities,
        camera_hint: item.camera_hint,
      })),
    });
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
    await onConfirm({ shots: confirmed }, mode);
    setSaving(false);
  }

  const included = items.filter((i) => i.included).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4 pb-32">
        <div className="mb-3 text-[11px] leading-relaxed text-t400">
          <span className="text-violet-600">✦</span>&nbsp;{" "}
          {t(
            `Claude предложил ${items.length} групп. Проверьте и поправьте описания — карточки создадутся после подтверждения.`,
            `Claude proposed ${items.length} groups. Review and edit the descriptions — cards are created after you confirm.`,
          )}
        </div>

        {hasExisting && (
          <div className="mb-3 flex gap-1.5">
            <button
              onClick={() => setMode("append")}
              className="min-h-9 flex-1 rounded-md border px-2 text-[10.5px] font-semibold"
              style={{
                borderColor: mode === "append" ? "var(--border-strong)" : "var(--border-subtle)",
                background: mode === "append" ? "var(--ink-600)" : "none",
                color: mode === "append" ? "var(--text-100)" : "var(--text-400)",
              }}
            >
              {t("Добавить новые (готовые не трогать)", "Add new (keep existing)")}
            </button>
            <button
              onClick={() => setMode("replace")}
              className="min-h-9 flex-1 rounded-md border px-2 text-[10.5px] font-semibold"
              style={{
                borderColor: mode === "replace" ? "rgba(194,71,106,.5)" : "var(--border-subtle)",
                background: mode === "replace" ? "rgba(194,71,106,.08)" : "none",
                color: mode === "replace" ? "#e08aa4" : "var(--text-400)",
              }}
            >
              {t(`Заменить все (${existingTitles.length})`, `Replace all (${existingTitles.length})`)}
            </button>
          </div>
        )}
        {mode === "replace" && hasExisting && (
          <div className="mb-3 text-[10.5px] text-warning">
            {t(
              "Существующие шоты, их промпты и связи будут удалены.",
              "Existing shots with their prompts and links will be deleted.",
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-lg border bg-ink-700 p-3"
              style={{
                opacity: item.included ? 1 : 0.45,
                borderColor:
                  item.duplicate && mode === "append"
                    ? "rgba(192,138,62,.4)"
                    : "var(--border-subtle)",
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={(e) => patch(i, { included: e.target.checked })}
                  className="h-5 w-5 accent-[var(--violet-400)]"
                />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
                  {t("Группа", "Group")} {String(i + 1).padStart(2, "0")} · {item.duration_sec}{" "}
                  {t("сек", "sec")}
                </span>
                {item.duplicate && mode === "append" && (
                  <span className="rounded bg-[rgba(192,138,62,.14)] px-1.5 py-0.5 text-[8px] font-semibold uppercase text-warning">
                    {t("похожа на существующую", "similar to an existing one")}
                  </span>
                )}
              </div>
              <input
                value={item.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                placeholder={t("Название группы", "Group title")}
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
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-lg gap-2 border-t border-[var(--border-default)] px-3 py-3 md:max-w-3xl lg:left-56 lg:mx-0 lg:max-w-none"
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
          {t("Отмена", "Cancel")}
        </button>
        <button
          onClick={confirm}
          disabled={saving || included === 0}
          className="min-h-[50px] flex-1 rounded-lg text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
          style={{
            background: mode === "replace" && hasExisting ? "var(--danger)" : "var(--violet-500)",
            boxShadow: mode === "replace" && hasExisting ? "none" : "var(--glow-violet-sm)",
          }}
        >
          {saving
            ? t("Создание…", "Creating…")
            : mode === "append" && hasExisting
              ? t(`Добавить ${included} новых`, `Add ${included} new`)
              : t(`Создать ${included} карточек`, `Create ${included} cards`)}
        </button>
      </div>
    </div>
  );
}
