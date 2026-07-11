"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";

/**
 * Обёртка «долгое зажатие» (~0.5 c) или правый клик → меню с опцией удаления.
 * Требование заказчика: серии и шоты удаляются не отдельной кнопкой,
 * а через long-press по элементу списка; само удаление — с подтверждением.
 */
export default function LongPressMenu({
  title,
  deleteLabel,
  confirmLabel,
  doneToast,
  action,
  children,
  className,
}: {
  title: string;
  deleteLabel: string;
  confirmLabel: string;
  doneToast: string;
  action: () => Promise<unknown>;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }

  function onPointerDown(e: React.PointerEvent) {
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fired.current = true;
      setOpen(true);
    }, 500);
  }

  function onPointerMove(e: React.PointerEvent) {
    // палец «поехал» — это скролл, а не зажатие
    if (!origin.current) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 12) cancel();
  }

  return (
    <>
      <div
        className={`select-none ${className ?? ""}`}
        style={{ WebkitTouchCallout: "none" }}
        title="Долгое зажатие — удалить"
        onPointerDown={onPointerDown}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onPointerMove={onPointerMove}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          setOpen(true);
        }}
        onClickCapture={(e) => {
          // клик, «отпустивший» long-press, не должен открыть ссылку под пальцем
          if (fired.current) {
            e.preventDefault();
            e.stopPropagation();
            fired.current = false;
          }
        }}
      >
        {children}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-2 pb-2 pt-1">
          <ConfirmButton
            action={async () => {
              await action();
              setOpen(false);
            }}
            label={deleteLabel}
            confirmLabel={confirmLabel}
            doneToast={doneToast}
            className="min-h-12 w-full rounded-lg border border-[rgba(194,71,106,.4)] text-[12px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
          />
          <button
            onClick={() => setOpen(false)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-semibold text-t300 hover:bg-ink-600"
          >
            Отмена
          </button>
        </div>
      </Sheet>
    </>
  );
}
