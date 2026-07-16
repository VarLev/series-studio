"use client";

/**
 * Самовосстановление долгих server actions через туннель (паттерн PromptBlock/
 * EnhanceButton): ответ долгого вызова часто теряется (trycloudflare ~100 с,
 * телефон свернул вкладку), поэтому НЕ полагаемся на возврат экшена — параллельно
 * поллим состояние на сервере и объявляем успех, как только оно изменилось.
 * Хук инкапсулирует таймеры и гонку «ответ против поллинга»: финиш срабатывает
 * ровно один раз, таймеры гасятся на размонтировании.
 */
import { useEffect, useRef, useState } from "react";

export type LongActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function useLongAction<T>() {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<{
    tick?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
  }>({});
  const doneRef = useRef(true);

  function cleanup() {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    timers.current = {};
  }
  useEffect(() => cleanup, []);

  function start(opts: {
    /** основной вызов; исключение (обрыв туннеля) НЕ ошибка — результат добирает poll */
    run: () => Promise<LongActionResult<T>>;
    /** проверка состояния на сервере: не-null → финиш (успех или ошибка из тайника) */
    poll?: () => Promise<LongActionResult<T> | null>;
    pollMs?: number;
    /** потолок ожидания, сек — дальше onErr(ceilingMsg) */
    ceilingSec: number;
    ceilingMsg: string;
    onOk: (value: T) => void;
    onErr: (msg: string) => void;
  }) {
    cleanup();
    doneRef.current = false;
    setBusy(true);
    setElapsed(0);
    const startedAt = Date.now();

    const finish = (res: LongActionResult<T>) => {
      if (doneRef.current) return;
      doneRef.current = true;
      cleanup();
      setBusy(false);
      if (res.ok) opts.onOk(res.value);
      else opts.onErr(res.error);
    };

    timers.current.tick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (sec >= opts.ceilingSec) finish({ ok: false, error: opts.ceilingMsg });
    }, 1000);

    if (opts.poll) {
      const poll = opts.poll;
      timers.current.poll = setInterval(async () => {
        try {
          const res = await poll();
          if (res) finish(res);
        } catch {
          // сеть моргнула — попробуем в следующий тик
        }
      }, opts.pollMs ?? 5000);
    }

    opts.run().then(finish, () => {
      // обрыв соединения: результат подхватит поллинг; без него дотикает потолок
    });
  }

  /**
   * Перестать ждать: гасим таймеры и отпускаем кнопку. Серверный вызов при этом
   * НЕ отменяется (его нельзя отозвать) и спокойно дозревает в тайник — поэтому
   * повторный запуск с тем же токеном не создаст вторую платную задачу.
   * Нужно там, где ожидание идёт минутами: сидеть до потолка без выхода — плохо.
   */
  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanup();
    setBusy(false);
  }

  return { busy, elapsed, start, cancel };
}
