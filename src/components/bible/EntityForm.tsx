"use client";

import { useRef, useState, useTransition } from "react";
import { updateEntity, setEntityArchived, deleteEntity, type EntityType } from "@/lib/actions/entities";
import { SectionLabel } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

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
  const t = useT();
  const [name, setName] = useState(entity.name);
  const [elementName, setElementName] = useState(entity.elementName);
  const [description, setDescription] = useState(entity.description);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        <SectionLabel>{t("Имя", "Name")}</SectionLabel>
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
        <SectionLabel hint={t("подставляется в промпты", "inserted into prompts")}>element_name</SectionLabel>
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
            {copied ? "✓" : t("Копировать", "Copy")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("попадает в контекст промпт-фабрики", "goes into the prompt factory context")}>
          {t("Описание", "Description")}
        </SectionLabel>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            save({ description: e.target.value });
          }}
          rows={5}
          placeholder={t(
            "Внешность, характер, визуальные детали — то, что должно быть стабильным от шота к шоту.",
            "Appearance, character, visual details — what must stay stable shot to shot.",
          )}
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
          <option value="character">{t("Персонаж", "Character")}</option>
          <option value="location">{t("Локация", "Location")}</option>
          <option value="prop">{t("Реквизит", "Prop")}</option>
          <option value="style">{t("Стиль", "Style")}</option>
        </select>
        <span className="flex-1" />
        <button
          onClick={() => startTransition(() => setEntityArchived(entity.id, !entity.archived))}
          className="min-h-10 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-t300 hover:text-t100"
        >
          {entity.archived ? t("Вернуть из архива", "Unarchive") : t("В архив", "Archive")}
        </button>
      </div>

      {/* spec §2.7: удаление — пропадает из библии и из чипов шотов */}
      <button
        onClick={() => {
          if (confirmDelete) startTransition(() => deleteEntity(entity.id));
          else setConfirmDelete(true);
        }}
        className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
      >
        {confirmDelete
          ? t("Точно удалить? (пропадёт из чипов шотов)", "Really delete? (disappears from shot chips)")
          : t("Удалить сущность", "Delete entity")}
      </button>
    </div>
  );
}
