"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { EntityAvatar, ENTITY_TYPE_LABEL } from "@/components/ui";
import { addShotEntity, removeShotEntity, setShotEntityOutfit } from "@/lib/actions/shots";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export interface ChipEntity {
  id: string;
  name: string;
  elementName: string;
  type: string;
  avatarUrl: string | null;
  linked: boolean;
  auto: boolean;
  /** наряд в этой группе (якорь одежды); пусто → базовый гардероб */
  outfit: string;
  /** базовый гардероб из библии (фолбэк и placeholder) */
  wardrobe: string;
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
  const [outfitFor, setOutfitFor] = useState<ChipEntity | null>(null);
  const [outfitText, setOutfitText] = useState("");
  const [pending, startTransition] = useTransition();
  const linked = entities.filter((e) => e.linked);
  const available = entities.filter((e) => !e.linked);

  function openOutfit(e: ChipEntity) {
    if (e.type !== "character") return;
    setOutfitFor(e);
    setOutfitText(e.outfit);
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {linked.map((e) => (
          <span
            key={e.id}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-1 pr-1.5"
            style={
              e.type === "character" && (e.outfit || e.wardrobe)
                ? { borderColor: "var(--border-strong)" }
                : undefined
            }
          >
            {/* тап по персонажу — якорь одежды этой группы */}
            <button
              onClick={() => openOutfit(e)}
              disabled={e.type !== "character"}
              title={
                e.type === "character"
                  ? e.outfit || e.wardrobe || t("Задать одежду в группе", "Set outfit for this group")
                  : undefined
              }
              className="inline-flex items-center gap-1.5 disabled:cursor-default"
            >
              <EntityAvatar name={e.name} imageUrl={e.avatarUrl} size={22} />
              <span className="text-[12px] font-medium text-t200">{e.name}</span>
              {e.type === "character" && (
                <span
                  className="text-[10px]"
                  style={{ color: e.outfit || e.wardrobe ? "var(--success)" : "var(--text-400)" }}
                >
                  👔
                </span>
              )}
            </button>
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

      {/* якорь одежды: наряд персонажа в ЭТОЙ группе (между группами может отличаться) */}
      <Sheet
        open={Boolean(outfitFor)}
        onClose={() => setOutfitFor(null)}
        title={`${t("Одежда в группе", "Outfit in this group")} · ${outfitFor?.name ?? ""}`}
      >
        {outfitFor && (
          <div className="flex flex-col gap-3 pb-2">
            <textarea
              value={outfitText}
              onChange={(e) => setOutfitText(e.target.value)}
              rows={3}
              autoFocus
              spellCheck={false}
              placeholder={
                outfitFor.wardrobe ||
                t(
                  "На английском, напр.: charcoal wool coat over white shirt, black jeans",
                  "In English, e.g.: charcoal wool coat over white shirt, black jeans",
                )
              }
              className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <p className="text-[11px] leading-relaxed text-t400">
              {t(
                "Одежда фиксируется для всех шотов этой группы (WARDROBE LOCK в промпте). Пусто — берётся базовый гардероб из библии. Пишите на английском: текст уходит в промпт как есть.",
                "Locked for every shot of this group (WARDROBE LOCK in the prompt). Empty — the bible's base wardrobe is used. Write in English: the text goes into the prompt verbatim.",
              )}
            </p>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setShotEntityOutfit(shotId, outfitFor.id, outfitText);
                  toast(t("Одежда группы сохранена", "Group outfit saved"));
                  setOutfitFor(null);
                })
              }
              className="min-h-11 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {pending ? t("Сохранение…", "Saving…") : t("Сохранить", "Save")}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
