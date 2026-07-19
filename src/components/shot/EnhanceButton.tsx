"use client";

/**
 * Enhance в шапке группы: выбранная модель промптов (через CLI/подписку) переоценивает
 * группу целиком — шоты Main/Draft, тайминг, приёмы по шотам, локация/погода/тон, «кто в кадре».
 *
 * Вызов долгий (60–120с) и идёт на сервере НЕЗАВИСИМО от клиента. Чтобы счётчик и
 * факт «идёт улучшение» переживали уход со страницы и перезагрузку, состояние
 * {startedAt, baseline} храним в localStorage: при монтировании восстанавливаем
 * счётчик от настоящего старта и продолжаем поллить «отпечаток» шотов группы
 * (groupBeatsStamp) — как только он изменился относительно ориентира, объявляем
 * успех сами (ответ самого экшена часто теряется в туннеле).
 */
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { enhanceGroup, groupBeatsStamp } from "@/lib/actions/shots";
import { useLongAction, type LongActionResult } from "@/components/useLongAction";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

const keyFor = (shotId: string) => `ss:enhance:${shotId}`;

export default function EnhanceButton({ shotId }: { shotId: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, elapsed, start } = useLongAction<void>();
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    },
    [],
  );

  const finishOk = useCallback(() => {
    try {
      localStorage.removeItem(keyFor(shotId));
    } catch {}
    toast(t("Группа улучшена", "Group enhanced"));
    // через туннель одиночный refresh может потеряться — повторяем несколько раз
    router.refresh();
    let tries = 0;
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => {
      router.refresh();
      if (++tries >= 4 && refreshTimer.current) clearInterval(refreshTimer.current);
    }, 1000);
  }, [shotId, t, router]);

  const finishErr = useCallback(
    (msg: string) => {
      try {
        localStorage.removeItem(keyFor(shotId));
      } catch {}
      toast(msg);
    },
    [shotId],
  );

  const beginWatch = useCallback(
    (startedAt: number, baseline: string, run: () => Promise<LongActionResult<void>>) => {
      start({
        run,
        poll: async () => {
          if (!baseline) return null; // ориентир не снят — ждём только по возврату/потолку
          try {
            const stamp = await groupBeatsStamp(shotId);
            return stamp !== baseline ? { ok: true, value: undefined } : null;
          } catch {
            return null;
          }
        },
        pollMs: 5000,
        ceilingSec: 300,
        ceilingMsg: t(
          "Ответа нет дольше 5 минут. Изменения могли не примениться — обновите страницу или попробуйте ещё раз.",
          "No response for over 5 minutes. Changes may not have applied — reload or try again.",
        ),
        startedAt,
        onOk: finishOk,
        onErr: finishErr,
      });
    },
    [shotId, t, start, finishOk, finishErr],
  );

  // восстановить счётчик и ожидание после ухода со страницы / перезагрузки
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(keyFor(shotId));
    } catch {}
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { startedAt?: number; baseline?: string };
      if (typeof saved.startedAt === "number") {
        // Enhance уже запущен на сервере — только ждём результат (run не резолвится сам,
        // финиш даёт poll по изменению отпечатка либо потолок в 5 минут)
        beginWatch(saved.startedAt, saved.baseline ?? "", () => new Promise<never>(() => {}));
      }
    } catch {}
    // один раз при монтировании для этой группы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotId]);

  async function onEnhance() {
    // ориентир для поллинга — текущее состояние шотов (свежее, с сервера)
    let baseline = "";
    try {
      baseline = await groupBeatsStamp(shotId);
    } catch {}
    const startedAt = Date.now();
    try {
      localStorage.setItem(keyFor(shotId), JSON.stringify({ startedAt, baseline }));
    } catch {}
    beginWatch(startedAt, baseline, async () => {
      const res = await enhanceGroup(shotId);
      return res.ok
        ? { ok: true as const, value: undefined }
        : { ok: false as const, error: res.error };
    });
  }

  return (
    <button
      onClick={onEnhance}
      disabled={busy}
      title={t(
        "Улучшит основные шоты (Main), НЕ пересобирая сюжет: уточнит планы/камеру, дозаполнит локацию/погоду/тон, при нехватке времени разобьёт шот, подберёт приёмы и определит, кто в кадре. Черновики (Draft) не трогает. Моделью промптов через подписку (CLI).",
        "Improves the Main shots WITHOUT rebuilding the plot: refines framing/camera, fills location/weather/tone, splits a shot if time is tight, picks techniques and detects who's in frame. Leaves Drafts untouched. Uses the prompt model via subscription (CLI).",
      )}
      className="flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-full border border-[var(--violet-400)] bg-[rgba(139,95,176,.12)] px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-100 hover:bg-[rgba(139,95,176,.2)] disabled:opacity-60"
      style={{ boxShadow: "var(--glow-violet-sm)" }}
    >
      {busy ? t(`Улучшаю… ${elapsed}с`, `Enhancing… ${elapsed}s`) : t("✨ Enhance", "✨ Enhance")}
    </button>
  );
}
