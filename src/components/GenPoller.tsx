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

  useEffect(() => {
    if (activeCount <= 0) return;
    const tick = async () => {
      // не поллим фоновую вкладку и не даём подвисшему запросу заблокировать цикл
      if (busy.current || document.visibilityState === "hidden") return;
      busy.current = true;
      try {
        // poll двигает статусы у провайдера И запускает фоновую отправку плейсхолдеров;
        // обновляем экран каждый тик, пока есть активные задачи — часть изменений
        // (проставленный jobId, провал фоновой отправки) происходит вне ответа poll
        await fetch("/api/generations/poll", {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
        });
        router.refresh();
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
