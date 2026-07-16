"use client";

/**
 * Переключатель «использовать / не использовать» — общий для документов базы
 * знаний и режиссёрских приёмов на вкладке «База знаний». Выключенное остаётся
 * в базе, но в модель не уходит.
 */
export default function Toggle({
  enabled,
  pending,
  onToggle,
  title,
}: {
  enabled: boolean;
  pending: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={pending}
      title={title}
      aria-pressed={enabled}
      className="relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50"
      style={{
        background: enabled ? "var(--violet-500)" : "var(--ink-800)",
        borderColor: enabled ? "transparent" : "var(--border-default)",
      }}
    >
      <span
        className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: enabled ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}
