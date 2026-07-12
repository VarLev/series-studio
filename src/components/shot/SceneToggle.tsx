"use client";

/**
 * Граница сюжетной сцены на карточке группы. «Начало новой сцены» = жёсткой
 * связности с предыдущей группой нет: промпт-фабрика не тянет обстановку/свет/
 * одежду, общие якоря — только персонажи и локации библии. «Продолжение» =
 * прямая непрерывность (подсказываем взять кадр предыдущей группы стартовым).
 */
import { useState, useTransition } from "react";
import { setSceneStart } from "@/lib/actions/shots";
import { useT } from "@/components/I18nProvider";

export default function SceneToggle({
  shotId,
  sceneStart,
  isFirst,
  prevGroupNo,
}: {
  shotId: string;
  sceneStart: boolean;
  /** первая группа серии — всегда начало сцены, переключать нечего */
  isFirst: boolean;
  /** номер предыдущей группы («03») — для подсказки start-frame */
  prevGroupNo: string | null;
}) {
  const t = useT();
  const [on, setOn] = useState(sceneStart); // мгновенный отклик, сервер догоняет
  const [, startTransition] = useTransition();
  const active = isFirst || on;

  function toggle() {
    if (isFirst) return;
    const next = !on;
    setOn(next);
    startTransition(() => setSceneStart(shotId, next));
  }

  return (
    <button
      onClick={toggle}
      disabled={isFirst}
      title={
        isFirst
          ? t("Первая группа серии всегда начинает сцену", "The first group always starts a scene")
          : t("Переключить границу сюжетной сцены", "Toggle the scene boundary")
      }
      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 text-left disabled:cursor-default"
      style={{
        borderColor: active ? "var(--border-strong)" : "var(--border-subtle)",
        background: active ? "var(--ink-600)" : "none",
      }}
    >
      <span className="text-[14px] leading-none">{active ? "🎬" : "↪"}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-semibold text-t100">
          {active
            ? t("Начало новой сцены", "New scene starts here")
            : t("Продолжение сцены", "Scene continues")}
        </span>
        <span className="block text-[10px] leading-snug text-t400">
          {active
            ? t(
                "Связности с предыдущей группой нет — якоря только из библии (персонажи, локации)",
                "No continuity with the previous group — anchors come from the bible only",
              )
            : prevGroupNo
              ? t(
                  `Прямая непрерывность с группой ${prevGroupNo} — start-frame можно взять из её кадров`,
                  `Direct continuity with group ${prevGroupNo} — grab its frame as the start-frame`,
                )
              : t("Прямая непрерывность с предыдущей группой", "Direct continuity with the previous group")}
        </span>
      </span>
      {!isFirst && (
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]"
          style={{
            borderColor: active ? "var(--border-strong)" : "var(--border-default)",
            color: active ? "var(--violet-200)" : "var(--text-400)",
          }}
        >
          {active ? t("сцена", "scene") : t("связка", "linked")}
        </span>
      )}
    </button>
  );
}
