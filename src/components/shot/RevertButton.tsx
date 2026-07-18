"use client";

/**
 * Revert в шапке группы, рядом с Enhance: возвращает группу в «первоначальное
 * состояние» — то, каким её создала раскадровка (снимок origin, см. revertGroup).
 * Разрушительно (стирает Enhance и ручные правки содержимого), поэтому двухшаговое
 * подтверждение по образцу ConfirmButton. Через туннель одиночный router.refresh()
 * может потеряться — повторяем несколько раз (паттерн EnhanceButton).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revertGroup } from "@/lib/actions/shots";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export default function RevertButton({ shotId }: { shotId: string }) {
  const t = useT();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    },
    [],
  );

  function onClick() {
    if (!armed) {
      // первый клик «взводит» — второй в течение 3.5 с выполняет откат
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(false);
    startTransition(async () => {
      const res = await revertGroup(shotId);
      if (!res.ok) {
        toast(res.error);
        return;
      }
      toast(t("Группа возвращена к раскадровке", "Group reverted to storyboard"));
      // action уже сделал revalidatePath; refresh подтягивает экран, а повтор
      // страхует от потери одиночного RSC-ответа в туннеле
      router.refresh();
      let tries = 0;
      refreshTimer.current = setInterval(() => {
        router.refresh();
        if (++tries >= 4 && refreshTimer.current) clearInterval(refreshTimer.current);
      }, 1000);
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      title={t(
        "Вернуть группу к состоянию раскадровки: шоты, тайминг, заголовок, тон, персонажи в кадре и якоря. Локацию/погоду сцены, статус и результаты (промпты, видео) не трогает. Отменяет Enhance и ручные правки содержимого.",
        "Revert the group to its storyboard state: shots, timing, title, tone, characters in frame and anchors. Leaves scene location/weather, status and results (prompts, videos) untouched. Undoes Enhance and manual content edits.",
      )}
      className={`flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-60 ${
        armed
          ? "border-danger bg-[rgba(194,71,106,.15)] text-[#e08aa4]"
          : "border-[var(--border-strong)] bg-[var(--ink-500)] text-t200 hover:bg-[var(--ink-400)] hover:text-t100"
      }`}
    >
      {pending
        ? t("Откат…", "Reverting…")
        : armed
          ? t("Точно? Откатить", "Sure? Revert")
          : t("↺ Revert", "↺ Revert")}
    </button>
  );
}
