"use client";

import Link from "next/link";
import { useState } from "react";
import { EntityAvatar, ENTITY_TYPE_LABEL, EmptyState } from "@/components/ui";
import { quickCreateEntity, type EntityType } from "@/lib/actions/entities";
import { deleteAllEntities } from "@/lib/actions/deletes";
import ConfirmButton from "@/components/ConfirmButton";
import { useT } from "@/components/I18nProvider";

export interface BibleItem {
  id: string;
  type: string;
  name: string;
  elementName: string;
  archived: boolean;
  avatarUrl: string | null;
  refCount: number;
}

const TYPE_ORDER: EntityType[] = ["character", "location", "prop", "style"];
const TYPE_PLURAL: Record<string, { ru: string; en: string }> = {
  character: { ru: "Персонажи", en: "Characters" },
  location: { ru: "Локации", en: "Locations" },
  prop: { ru: "Реквизит", en: "Props" },
  style: { ru: "Стили", en: "Styles" },
};

export default function BibleList({ items }: { items: BibleItem[] }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [addingType, setAddingType] = useState<EntityType | null>(null);

  const filtered = items.filter((item) => {
    if (!showArchived && item.archived) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (query && !`${item.name} ${item.elementName}`.toLowerCase().includes(query.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4 p-4 pb-10">
      <div className="text-[11px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp;{" "}
        {t(
          "Claude подставляет токены сущностей в промпты автоматически. Тап по сущности — описание и референсы.",
          "Claude inserts entity tokens into prompts automatically. Tap an entity for its description and references.",
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Поиск по имени или element_name", "Search by name or element_name")}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[13px] text-t100 outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTypeFilter("")}
            className="min-h-8 rounded-full border px-3 text-[11px] font-medium"
            style={{
              borderColor: !typeFilter ? "var(--border-strong)" : "var(--border-subtle)",
              background: !typeFilter ? "var(--ink-600)" : "none",
              color: !typeFilter ? "var(--text-100)" : "var(--text-300)",
            }}
          >
            {t("Все", "All")}
          </button>
          {TYPE_ORDER.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
              className="min-h-8 rounded-full border px-3 text-[11px] font-medium"
              style={{
                borderColor: typeFilter === type ? "var(--border-strong)" : "var(--border-subtle)",
                background: typeFilter === type ? "var(--ink-600)" : "none",
                color: typeFilter === type ? "var(--text-100)" : "var(--text-300)",
              }}
            >
              {t(TYPE_PLURAL[type].ru, TYPE_PLURAL[type].en)}
            </button>
          ))}
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="min-h-8 rounded-full border border-[var(--border-subtle)] px-3 text-[11px] text-t400"
            style={{ background: showArchived ? "var(--ink-600)" : "none" }}
          >
            {t("архив", "archive")}
          </button>
        </div>
      </div>

      {TYPE_ORDER.filter((type) => !typeFilter || typeFilter === type).map((type) => {
        const group = filtered.filter((i) => i.type === type);
        const plural = t(TYPE_PLURAL[type].ru, TYPE_PLURAL[type].en);
        return (
          <div key={type} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="section-label">{plural}</span>
              <span className="font-mono text-[10px] text-t400">{group.length}</span>
              <span className="flex-1" />
              {items.filter((i) => i.type === type).length > 1 && (
                <ConfirmButton
                  action={deleteAllEntities.bind(null, type)}
                  label={t("удалить все", "delete all")}
                  confirmLabel={t("Удалить все?", "Delete all?")}
                  doneToast={t(`Удалено: ${plural}`, `Deleted: ${plural}`)}
                  className="min-h-[30px] rounded-full border border-[var(--border-subtle)] px-3 text-[10px] font-semibold text-t400 hover:border-[rgba(194,71,106,.4)] hover:text-danger disabled:opacity-50"
                  armedClassName="border-danger text-danger"
                />
              )}
              {/* spec §2.7: создаёт сущность с токеном CHAR_N/LOC_N/OBJ_N и сразу открывает карточку */}
              <button
                onClick={() => {
                  setAddingType(type);
                  quickCreateEntity(type);
                }}
                disabled={addingType === type}
                className="min-h-[30px] rounded-full border border-dashed border-[var(--border-default)] px-3 text-[10px] font-semibold text-violet-200 hover:border-[var(--border-strong)] hover:text-violet-100 disabled:opacity-50"
              >
                {addingType === type ? t("Создание…", "Creating…") : t("+ Добавить", "+ Add")}
              </button>
            </div>

            {group.length === 0 && addingType !== type && (
              <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-2.5 text-[11px] text-t400">
                {t("Пока пусто.", "Empty for now.")}
              </div>
            )}

            {group.map((item) => (
              <Link
                key={item.id}
                href={`/bible/${item.id}`}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 hover:border-[var(--border-strong)] hover:bg-ink-600"
                style={{ opacity: item.archived ? 0.5 : 1 }}
              >
                <EntityAvatar name={item.name} imageUrl={item.avatarUrl} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-t100">
                    {item.name}
                    {item.archived ? t(" · архив", " · archived") : ""}
                  </span>
                  <span className="block text-[10px] text-t400">
                    {item.refCount} {t("реф.", "refs")} ·{" "}
                    {ENTITY_TYPE_LABEL[item.type]
                      ? t(ENTITY_TYPE_LABEL[item.type].ru, ENTITY_TYPE_LABEL[item.type].en)
                      : item.type}
                  </span>
                </span>
                <span className="rounded border border-[rgba(139,95,176,.3)] bg-[rgba(139,95,176,.1)] px-1.5 py-1 font-mono text-[10px] font-semibold text-violet-200">
                  {item.elementName}
                </span>
              </Link>
            ))}
          </div>
        );
      })}

      {items.length === 0 && (
        <EmptyState>
          {t(
            "Библия пуста. Добавьте персонажей, локации и стили — их element_name будут подставляться в промпты, а референсы прикрепляться к генерациям.",
            "The bible is empty. Add characters, locations and styles — their element_names go into prompts and their references attach to generations.",
          )}
        </EmptyState>
      )}
    </div>
  );
}
