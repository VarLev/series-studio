"use client";

/**
 * Enhance в шапке группы: Opus через CLI (подписка) переоценивает группу целиком —
 * шоты Main/Draft, тайминг, приёмы по шотам, локация/погода/тон, «кто в кадре».
 *
 * Вызов долгий (Opus 60–120с) — ответ server action может потеряться в туннеле
 * («Failed to fetch», реальный инцидент). Поэтому НЕ полагаемся на возврат:
 * параллельно поллим «отпечаток» шотов группы (groupBeatsStamp) и, как только
 * он изменился относительно ориентира, объявляем успех сами (паттерн PromptBlock).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { enhanceGroup, groupBeatsStamp } from "@/lib/actions/shots";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export default function EnhanceButton({ shotId }: { shotId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<{
    tick?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const doneRef = useRef(false);

  function cleanupTimers() {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.refresh) clearInterval(timers.current.refresh);
    timers.current = {};
  }
  useEffect(() => cleanupTimers, []);

  function finishOk() {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    setBusy(false);
    toast(t("Группа улучшена (Opus)", "Group enhanced (Opus)"));
    // через туннель одиночный refresh может потеряться — повторяем несколько раз
    router.refresh();
    let tries = 0;
    const iv = setInterval(() => {
      router.refresh();
      if (++tries >= 4) clearInterval(iv);
    }, 1000);
    timers.current.refresh = iv;
  }

  function finishErr(msg: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanupTimers();
    setBusy(false);
    toast(msg);
  }

  async function onEnhance() {
    setElapsed(0);
    setBusy(true);
    doneRef.current = false;
    // ориентир для поллинга — текущее состояние шотов (свежее, с сервера)
    let baseline: string | null = null;
    try {
      baseline = await groupBeatsStamp(shotId);
    } catch {
      // не смогли снять ориентир — работаем без поллинга, только по возврату
    }
    const startedAt = Date.now();
    timers.current.tick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (sec >= 300) {
        finishErr(
          t(
            "Ответа нет дольше 5 минут. Изменения могли не примениться — обновите страницу или попробуйте ещё раз.",
            "No response for over 5 minutes. Changes may not have applied — reload or try again.",
          ),
        );
      }
    }, 1000);
    if (baseline !== null) {
      timers.current.poll = setInterval(async () => {
        try {
          const stamp = await groupBeatsStamp(shotId);
          if (stamp !== baseline) finishOk();
        } catch {
          // сеть моргнула — попробуем в следующий тик
        }
      }, 5000);
    }
    try {
      const res = await enhanceGroup(shotId);
      if (res.ok) finishOk();
      else finishErr(res.error);
    } catch {
      // обрыв соединения (туннель): результат подхватит поллинг выше; если
      // ориентира нет — дотикает потолок 5 минут с понятным сообщением
    }
  }

  return (
    <button
      onClick={onEnhance}
      disabled={busy}
      title={t(
        "Opus улучшит основные шоты (Main), НЕ пересобирая сюжет: уточнит планы/камеру, дозаполнит локацию/погоду/тон, при нехватке времени разобьёт шот, подберёт приёмы и определит, кто в кадре. Черновики (Draft) не трогает. Через подписку (CLI).",
        "Opus improves the Main shots WITHOUT rebuilding the plot: refines framing/camera, fills location/weather/tone, splits a shot if time is tight, picks techniques and detects who's in frame. Leaves Drafts untouched. Via subscription (CLI).",
      )}
      className="flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-full border border-[var(--violet-400)] bg-[rgba(139,95,176,.12)] px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-100 hover:bg-[rgba(139,95,176,.2)] disabled:opacity-60"
      style={{ boxShadow: "var(--glow-violet-sm)" }}
    >
      {busy ? t(`Opus… ${elapsed}с`, `Opus… ${elapsed}s`) : t("✨ Enhance", "✨ Enhance")}
    </button>
  );
}
