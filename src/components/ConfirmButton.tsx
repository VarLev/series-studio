"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * Кнопка с обязательным подтверждением (двухшаговая): первый клик «взводит»,
 * второй — выполняет. Через ~3.5 с сбрасывается. Все удаления в приложении
 * идут через неё (требование заказчика — удаления только с подтверждением).
 */
export default function ConfirmButton({
  action,
  label,
  confirmLabel,
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
  const t = useT();
  const confirmText = confirmLabel ?? t("Точно удалить?", "Really delete?");
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
    // action обязан сам ревалидировать текущую страницу (revalidatePath) —
    // обновлённый экран приезжает в том же ответе, без второго круга по сети
    startTransition(async () => {
      const res = await action();
      // action вправе вернуть Result: на {ok:false} он уже показал свой тост —
      // рапортовать поверх него об успехе нельзя
      if (res && typeof res === "object" && "ok" in res && res.ok === false) return;
      if (doneToast) toast(doneToast);
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
      {pending ? t("Удаление…", "Deleting…") : armed ? confirmText : label}
    </button>
  );
}
