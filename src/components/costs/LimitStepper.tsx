"use client";

import { useState } from "react";

/** Лимит подтверждения (spec §2.9): кнопки ±20 кр, диапазон 20–600. */
export default function LimitStepper({ name, initial }: { name: string; initial: number }) {
  const [value, setValue] = useState(Math.min(600, Math.max(20, initial || 50)));
  const bump = (d: number) => setValue((v) => Math.min(600, Math.max(20, v + d)));
  return (
    <div className="flex items-center gap-2">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => bump(-20)}
        className="flex h-11 w-12 items-center justify-center rounded-lg border border-[var(--border-default)] font-mono text-[14px] text-t200 hover:bg-ink-500"
      >
        −20
      </button>
      <div className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-ink-700 font-mono text-[15px] font-semibold text-t100">
        {value} кр
      </div>
      <button
        type="button"
        onClick={() => bump(20)}
        className="flex h-11 w-12 items-center justify-center rounded-lg border border-[var(--border-default)] font-mono text-[14px] text-t200 hover:bg-ink-500"
      >
        +20
      </button>
    </div>
  );
}
