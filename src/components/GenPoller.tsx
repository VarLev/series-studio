"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Клиентский поллинг статусов (TZ M4а): пока на экране есть активные задачи,
 * раз в ~6 секунд дергаем сервер и обновляем данные страницы.
 */
export default function GenPoller({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const busy = useRef(false);
  // последний отпечаток состояния задач: рефрешим тяжёлую RSC-страницу (полный
  // пейлоад через туннель) ТОЛЬКО когда он сменился, а не безусловно каждый тик
  const lastFp = useRef<string | null>(null);

  useEffect(() => {
    if (activeCount <= 0) return;
    const tick = async () => {
      // не поллим фоновую вкладку и не даём подвисшему запросу заблокировать цикл
      if (busy.current || document.visibilityState === "hidden") return;
      busy.current = true;
      try {
        // poll двигает статусы у провайдера И запускает фоновую отправку плейсхолдеров,
        // затем возвращает отпечаток состояния (fp), уже учитывающий фоновые изменения
        const res = await fetch("/api/generations/poll", {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return; // 401/500 — не рефрешим, попробуем в следующий тик
        const data = (await res.json().catch(() => null)) as { fp?: string } | null;
        const fp = data?.fp;
        if (typeof fp === "string") {
          // первый тик — только запоминаем отпечаток (страница только что отрендерена)
          if (lastFp.current !== null && fp !== lastFp.current) router.refresh();
          lastFp.current = fp;
        } else {
          router.refresh(); // ответ без отпечатка (старый роут) — обновим на всякий случай
        }
      } catch {
        // сеть моргнула — попробуем в следующий тик
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => clearInterval(id);
  }, [activeCount, router]);

  return null;
}
