"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { EntityAvatar, ENTITY_TYPE_LABEL } from "@/components/ui";
import { addShotEntity, removeShotEntity } from "@/lib/actions/shots";
import { useT } from "@/components/I18nProvider";

export interface ChipEntity {
  id: string;
  name: string;
  elementName: string;
  type: string;
  avatarUrl: string | null;
  linked: boolean;
  auto: boolean;
}

export default function EntityChips({
  shotId,
  entities,
}: {
  shotId: string;
  entities: ChipEntity[];
}) {
  const t = useT();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, startTransition] = useTransition();
  const linked = entities.filter((e) => e.linked);
  const available = entities.filter((e) => !e.linked);

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {linked.map((e) => (
          <span
            key={e.id}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-1 pr-1.5"
          >
            <EntityAvatar name={e.name} imageUrl={e.avatarUrl} size={22} />
            <span className="text-[12px] font-medium text-t200">{e.name}</span>
            {e.auto && (
              <span className="rounded-[3px] bg-[rgba(139,95,176,.14)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-300">
                {t("авто", "auto")}
              </span>
            )}
            <button
              aria-label={`${t("Убрать", "Remove")} ${e.name}`}
              onClick={() => startTransition(() => removeShotEntity(shotId, e.id))}
              className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
        <button
          aria-label="Добавить сущность"
          onClick={() => setSheetOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-[15px] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          +
        </button>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("Добавить сущность", "Add entity")}>
        {available.length === 0 && (
          <div className="pb-3 text-[12px] text-t400">
            {t(
              "Все сущности библии уже добавлены — или библия пуста. Новые создаются в разделе «Библия».",
              "All bible entities are already added — or the bible is empty. New ones are created in the Bible section.",
            )}
          </div>
        )}
        <div className="flex flex-col">
          {available.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                startTransition(() => addShotEntity(shotId, e.id));
                setSheetOpen(false);
              }}
              className="flex min-h-12 items-center gap-2.5 border-b border-[var(--border-subtle)] px-1 py-2 text-left hover:bg-ink-600"
            >
              <EntityAvatar name={e.name} imageUrl={e.avatarUrl} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-t100">{e.name}</span>
                <span className="block text-[10px] text-t400">
                  {ENTITY_TYPE_LABEL[e.type]
                    ? t(ENTITY_TYPE_LABEL[e.type].ru, ENTITY_TYPE_LABEL[e.type].en)
                    : e.type}
                </span>
              </span>
              <span className="font-mono text-[10px] text-violet-200">{e.elementName}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
