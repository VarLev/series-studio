"use client";

import { useRef, useState, useTransition } from "react";
import { updateEntity, setEntityArchived, type EntityType } from "@/lib/actions/entities";
import { SectionLabel } from "@/components/ui";

export default function EntityForm({
  entity,
}: {
  entity: {
    id: string;
    type: string;
    name: string;
    elementName: string;
    description: string;
    soulId: string;
    archived: boolean;
  };
}) {
  const [name, setName] = useState(entity.name);
  const [elementName, setElementName] = useState(entity.elementName);
  const [description, setDescription] = useState(entity.description);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function save(patch: { name?: string; elementName?: string; description?: string }) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => startTransition(() => updateEntity(entity.id, patch as Parameters<typeof updateEntity>[1])),
      800,
    );
  }

  async function copyElement() {
    await navigator.clipboard.writeText(elementName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Имя</SectionLabel>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            save({ name: e.target.value });
          }}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel hint="подставляется в промпты">element_name</SectionLabel>
        <div className="flex gap-2">
          <input
            value={elementName}
            onChange={(e) => {
              setElementName(e.target.value);
              save({ elementName: e.target.value });
            }}
            spellCheck={false}
            className="min-h-11 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 font-mono text-[13px] text-violet-200 outline-none focus:border-[var(--border-strong)]"
          />
          <button
            onClick={copyElement}
            className="min-h-11 rounded-lg border border-[var(--border-default)] px-4 text-[11px] font-semibold text-t200 hover:bg-ink-500"
          >
            {copied ? "✓" : "Копировать"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel hint="попадает в контекст промпт-фабрики">Описание</SectionLabel>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            save({ description: e.target.value });
          }}
          rows={5}
          placeholder="Внешность, характер, визуальные детали — то, что должно быть стабильным от шота к шоту."
          className="resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 text-[13px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <div className="flex items-center gap-3">
        <select
          defaultValue={entity.type}
          onChange={(e) =>
            startTransition(() => updateEntity(entity.id, { type: e.target.value as EntityType }))
          }
          className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
        >
          <option value="character">Персонаж</option>
          <option value="location">Локация</option>
          <option value="prop">Реквизит</option>
          <option value="style">Стиль</option>
        </select>
        <span className="flex-1" />
        <button
          onClick={() => startTransition(() => setEntityArchived(entity.id, !entity.archived))}
          className="min-h-10 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-t300 hover:text-t100"
        >
          {entity.archived ? "Вернуть из архива" : "В архив"}
        </button>
      </div>
    </div>
  );
}
