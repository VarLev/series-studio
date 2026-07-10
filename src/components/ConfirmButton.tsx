"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";

/**
 * Кнопка с обязательным подтверждением (двухшаговая): первый клик «взводит»,
 * второй — выполняет. Через ~3.5 с сбрасывается. Все удаления в приложении
 * идут через неё (требование заказчика — удаления только с подтверждением).
 */
export default function ConfirmButton({
  action,
  label,
  confirmLabel = "Точно удалить?",
  doneToast,
  className,
  armedClassName,
}: {
  action: () => Promise<unknown>;
  label: React.ReactNode;
  confirmLabel?: string;
  doneToast?: string;
  className?: string;
  armedClassName?: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onClick() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    startTransition(async () => {
      await action();
      if (doneToast) toast(doneToast);
      router.refresh();
    });
  }

  const base =
    className ??
    "min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50";
  const armedCls =
    armedClassName ?? "border-danger bg-[rgba(194,71,106,.15)] text-[#e08aa4]";

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={`${base} ${armed ? armedCls : ""}`}
    >
      {pending ? "Удаление…" : armed ? confirmLabel : label}
    </button>
  );
}
