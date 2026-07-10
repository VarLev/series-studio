"use client";

import { useEffect } from "react";

/** Bottom sheet (шторка) — основной паттерн вторичных экранов на мобиле. */
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
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer border-none"
        style={{ background: "rgba(6,5,9,.76)", backdropFilter: "blur(5px)" }}
      />
      <div
        className="sheet-up relative max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--border-default)] bg-ink-700 pb-6"
        style={{ boxShadow: "var(--shadow-xl)", paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
      >
        <div className="sticky top-0 z-10 flex justify-center bg-ink-700 pb-1 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-ink-300" />
        </div>
        {title && (
          <div className="px-4 pb-2.5 text-[14px] font-semibold text-t100">{title}</div>
        )}
        <div className="px-4">{children}</div>
      </div>
    </div>
  );
}
