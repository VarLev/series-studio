"use client";

import { useOptimistic, useTransition } from "react";
import { addShotEntity, removeShotEntity } from "@/lib/actions/shots";
import { useT } from "@/components/I18nProvider";

/** Наборы стилей (spec §2.3): переключаемые чипы, уходят в промпт-фабрику. */
export default function StyleChips({
  shotId,
  styles,
}: {
  shotId: string;
  styles: Array<{ id: string; name: string; linked: boolean }>;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  // тумблер отражается мгновенно, сервер догоняет в фоне (см. EntityChips)
  const [optimisticStyles, toggleLinked] = useOptimistic(styles, (state, id: string) =>
    state.map((s) => (s.id === id ? { ...s, linked: !s.linked } : s)),
  );
  if (!styles.length) {
    return (
      <span className="text-[10.5px] text-t400">
        {t(
          "Стили создаются в библии (тип «Стиль») и включаются здесь чипами.",
          "Styles are created in the bible (type “Style”) and toggled here as chips.",
        )}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {optimisticStyles.map((s) => (
        <button
          key={s.id}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              toggleLinked(s.id);
              await (s.linked ? removeShotEntity(shotId, s.id) : addShotEntity(shotId, s.id));
            })
          }
          className="min-h-8 rounded-full border px-3 text-[11px] font-medium disabled:opacity-50"
          style={{
            borderColor: s.linked ? "var(--border-strong)" : "var(--border-subtle)",
            background: s.linked ? "rgba(139,95,176,.14)" : "none",
            color: s.linked ? "var(--violet-100)" : "var(--text-400)",
          }}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
