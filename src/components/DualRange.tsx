"use client";

/**
 * Двухползунковый горизонтальный бегунок (min–max) на pointer-событиях —
 * тач-first, без нативного <input type=range> (у него нет двух ручек).
 * Тап по треку двигает ближайшую ручку; ручки не могут перескочить друг друга.
 */
import { useRef } from "react";

export default function DualRange({
  min,
  max,
  step = 1,
  low,
  high,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | "low" | "high">(null);
  const range = max - min || 1;
  const pct = (v: number) => ((v - min) / range) * 100;

  function valueAt(clientX: number): number {
    const el = trackRef.current;
    if (!el) return low;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round((min + ratio * range) / step) * step;
  }

  function pick(v: number): "low" | "high" {
    if (v <= low) return "low";
    if (v >= high) return "high";
    return Math.abs(v - low) <= Math.abs(v - high) ? "low" : "high";
  }

  function apply(which: "low" | "high", v: number) {
    if (which === "low") onChange(Math.min(v, high), high);
    else onChange(low, Math.max(v, low));
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    const v = valueAt(e.clientX);
    const which = pick(v);
    drag.current = which;
    trackRef.current?.setPointerCapture(e.pointerId);
    apply(which, v);
  }
  function move(e: React.PointerEvent) {
    if (drag.current) apply(drag.current, valueAt(e.clientX));
  }
  function up(e: React.PointerEvent) {
    drag.current = null;
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  }

  const thumb =
    "pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full " +
    "border-2 border-violet-400 bg-ink-600";

  return (
    <div
      ref={trackRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="relative h-9 cursor-pointer touch-none select-none"
    >
      {/* трек */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink-500" />
      {/* заполнение между ручками */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-violet-500"
        style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }}
      />
      {/* ручки */}
      <div className={thumb} style={{ left: `${pct(low)}%`, boxShadow: "var(--glow-violet-sm)" }} />
      <div className={thumb} style={{ left: `${pct(high)}%`, boxShadow: "var(--glow-violet-sm)" }} />
    </div>
  );
}
