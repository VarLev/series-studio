"use client";

import { useState, useTransition } from "react";
import { updateEntity, setEntityArchived, deleteEntity, type EntityType } from "@/lib/actions/entities";
import { SectionLabel } from "@/components/ui";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

interface Fields {
  name: string;
  elementName: string;
  description: string;
  type: string;
}

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
  // сохранение только по кнопке Save (замечание заказчика) — правки живут
  // локально, dirty сравнивается со снимком последнего сохранённого состояния
  const initial: Fields = {
    name: entity.name,
    elementName: entity.elementName,
    description: entity.description,
    type: entity.type,
  };
  const [fields, setFields] = useState<Fields>(initial);
  const [saved, setSaved] = useState<Fields>(initial);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty =
    fields.name !== saved.name ||
    fields.elementName !== saved.elementName ||
    fields.description !== saved.description ||
    fields.type !== saved.type;

  function save() {
    const snapshot = { ...fields };
    startTransition(async () => {
      await updateEntity(entity.id, {
        name: snapshot.name,
        elementName: snapshot.elementName,
        description: snapshot.description,
        type: snapshot.type as EntityType,
      });
      setSaved(snapshot);
      toast(t("Сущность сохранена", "Entity saved"));
    });
  }

  async function copyElement() {
    await navigator.clipboard.writeText(fields.elementName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>{t("Имя", "Name")}</SectionLabel>
        <input
          value={fields.name}
          onChange={(e) => setFields({ ...fields, name: e.target.value })}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("подставляется в промпты", "inserted into prompts")}>element_name</SectionLabel>
        <div className="flex gap-2">
          <input
            value={fields.elementName}
            onChange={(e) => setFields({ ...fields, elementName: e.target.value })}
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
          value={fields.description}
          onChange={(e) => setFields({ ...fields, description: e.target.value })}
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
          value={fields.type}
          onChange={(e) => setFields({ ...fields, type: e.target.value })}
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

      <button
        onClick={save}
        disabled={pending || !dirty}
        className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-50"
        style={{ boxShadow: dirty ? "var(--glow-violet-sm)" : "none" }}
      >
        {pending
          ? t("Сохранение…", "Saving…")
          : dirty
            ? t("Сохранить", "Save")
            : t("Сохранено", "Saved")}
      </button>

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
