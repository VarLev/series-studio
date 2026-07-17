"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Клиентский поллинг статусов (TZ M4а): пока на экране есть активные задачи,
 * раз в ~6 секунд дергаем сервер и обновляем данные страницы.
 *
 * initialFp — отпечаток состояния на момент РЕНДЕРА страницы. Он и есть базлайн:
 * без него первый тик запоминал свежий отпечаток как исходный, и статус, который
 * успел проставить вебхук/крон/соседний таб между рендером и первым тиком, уже
 * никогда не приводил к рефрешу — страница навсегда залипала на «генерируется».
 */
export default function GenPoller({
  activeCount,
  initialFp,
}: {
  activeCount: number;
  initialFp?: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  // последний отпечаток состояния задач: рефрешим тяжёлую RSC-страницу (полный
  // пейлоад через туннель) ТОЛЬКО когда он сменился, а не безусловно каждый тик
  const lastFp = useRef<string | null>(initialFp ?? null);

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
        const data = (await res.json().catch(() => null)) as
          | { updated?: number; fp?: string }
          | null;
        const fp = data?.fp;
        if (typeof fp === "string") {
          // Рефреш в двух случаях. (1) poll сам что-то записал (updated > 0) — это
          // покрывает и _poll-ошибки связи, которых в отпечатке нет (бейдж «нет
          // связи» должен появляться). (2) отпечаток разошёлся с базлайном — любые
          // изменения помимо poll, включая пришедшие ДО первого тика (базлайн взят
          // на рендере страницы, см. initialFp).
          const changed =
            (data?.updated ?? 0) > 0 || (lastFp.current !== null && fp !== lastFp.current);
          if (changed) router.refresh();
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
