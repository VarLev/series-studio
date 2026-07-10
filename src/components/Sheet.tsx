"use client";

import { useEffect } from "react";

/**
 * Шторка: на мобиле — снизу (bottom sheet), на десктопе (lg+) — справа (drawer).
 * Требование заказчика: на десктопе все панели открываются справа, нижних нет.
 */
export default function Sheet({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:flex-row lg:justify-end">
      <button
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer border-none"
        style={{ background: "rgba(6,5,9,.76)", backdropFilter: "blur(5px)" }}
      />
      <div
        className="sheet-up relative max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--border-default)] bg-ink-700 pb-6 lg:h-full lg:max-h-none lg:w-[440px] lg:rounded-l-2xl lg:rounded-tr-none lg:border-l lg:border-t-0"
        style={{ boxShadow: "var(--shadow-xl)", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
      >
        {/* мобильная «ручка» */}
        <div className="sticky top-0 z-10 flex justify-center bg-ink-700 pb-1 pt-2.5 lg:hidden">
          <div className="h-1 w-9 rounded-full bg-ink-300" />
        </div>
        {/* десктопная шапка с крестиком */}
        <div className="sticky top-0 z-10 hidden items-center gap-2 border-b border-[var(--border-subtle)] bg-ink-700 px-4 py-3 lg:flex">
          <span className="flex-1 text-[14px] font-semibold text-t100">{title}</span>
          <button
            aria-label="Закрыть"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-t100"
          >
            ×
          </button>
        </div>
        {title && (
          <div className="px-4 pb-2.5 pt-1 text-[14px] font-semibold text-t100 lg:hidden">{title}</div>
        )}
        <div className="px-4 lg:pt-3">{children}</div>
      </div>
    </div>
  );
}
