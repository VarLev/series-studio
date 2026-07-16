"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { EntityAvatar, ENTITY_TYPE_LABEL } from "@/components/ui";
import {
  addShotEntity,
  createEntityFromUnlinked,
  dismissUnlinkedChar,
  removeShotEntity,
  setShotEntityOutfit,
} from "@/lib/actions/shots";
import { effectiveOutfit } from "@/lib/wardrobe";
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
  /** сценарный наряд в этой группе (из разбивки/ручной правки) */
  outfit: string;
  /** базовый гардероб из библии */
  wardrobe: string;
  /** источник для промпта: "" | "bible" → библия, "generated" → сценарный наряд */
  outfitSource: string;
}

type Source = "bible" | "generated";

export default function EntityChips({
  shotId,
  entities,
  unlinked = [],
}: {
  shotId: string;
  entities: ChipEntity[];
  /** персонажи из разбивки, которых нет в библии — красные чипы-заготовки */
  unlinked?: string[];
}) {
  const t = useT();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [outfitFor, setOutfitFor] = useState<ChipEntity | null>(null);
  const [outfitText, setOutfitText] = useState("");
  const [source, setSource] = useState<Source>("bible");
  const [pending, startTransition] = useTransition();
  // шторка «завести в библию» для чипа-заготовки
  const [newFor, setNewFor] = useState<string | null>(null);
  const [newDesc, setNewDesc] = useState("");
  const [newWardrobe, setNewWardrobe] = useState("");
  // добавление/удаление чипа отражается мгновенно, сервер догоняет в фоне
  // (без этого на медленной сети — напр. через туннель — клик выглядит «не работает»)
  const [optimisticEntities, setLinked] = useOptimistic(
    entities,
    (state, change: { id: string; linked: boolean }) =>
      state.map((e) => (e.id === change.id ? { ...e, linked: change.linked } : e)),
  );
  const linked = optimisticEntities.filter((e) => e.linked);
  const available = optimisticEntities.filter((e) => !e.linked);

  function openOutfit(e: ChipEntity) {
    if (e.type !== "character") return;
    setOutfitFor(e);
    setOutfitText(e.outfit);
    setSource(e.outfitSource === "generated" ? "generated" : "bible");
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {linked.map((e) => {
          // что реально уйдёт в промпт (для индикатора чипа)
          const eff = effectiveOutfit(e, e.wardrobe);
          const isChar = e.type === "character";
          return (
            <span
              key={e.id}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-1 pr-1.5"
              style={isChar && eff ? { borderColor: "var(--border-strong)" } : undefined}
            >
              {/* тап по персонажу — якорь одежды этой группы */}
              <button
                onClick={() => openOutfit(e)}
                disabled={!isChar}
                title={isChar ? eff || t("Задать одежду в группе", "Set outfit for this group") : undefined}
                className="inline-flex items-center gap-1.5 disabled:cursor-default"
              >
                <EntityAvatar name={e.name} imageUrl={e.avatarUrl} size={22} />
                <span className="text-[12px] font-medium text-t200">{e.name}</span>
                {isChar && (
                  <span
                    className="text-[10px]"
                    style={{ color: eff ? "var(--success)" : "var(--text-400)" }}
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
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setLinked({ id: e.id, linked: false });
                    await removeShotEntity(shotId, e.id);
                  })
                }
                className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
              >
                ×
              </button>
            </span>
          );
        })}
        {/* Заготовки: модель назвала персонажа, в библии его нет. Красный чип без
            картинки — тап заводит в библию, × снимает (тогда видеомодель нарисует
            его без референса). */}
        {unlinked.map((name) => (
          <span
            key={`u-${name}`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border py-1 pl-2 pr-1.5"
            style={{ borderColor: "var(--danger)", background: "rgba(194,71,106,.10)" }}
          >
            <button
              onClick={() => {
                setNewFor(name);
                setNewDesc("");
                setNewWardrobe("");
              }}
              title={t(
                "Нет в библии — тап, чтобы добавить персонажа (иначе видео нарисует его без референса)",
                "Not in the bible — tap to add this character (otherwise video renders them with no reference)",
              )}
              className="inline-flex items-center gap-1.5"
            >
              <span className="text-[11px] leading-none text-danger">⚠</span>
              <span className="text-[12px] font-medium" style={{ color: "#e08aa4" }}>
                {name}
              </span>
              <span className="rounded-[3px] bg-[rgba(194,71,106,.18)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-danger">
                {t("нет в библии", "not in bible")}
              </span>
            </button>
            <button
              aria-label={`${t("Убрать", "Remove")} ${name}`}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await dismissUnlinkedChar(shotId, name);
                  router.refresh();
                })
              }
              className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
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
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  setLinked({ id: e.id, linked: true });
                  await addShotEntity(shotId, e.id);
                });
                setSheetOpen(false);
              }}
              className="flex min-h-12 items-center gap-2.5 border-b border-[var(--border-subtle)] px-1 py-2 text-left hover:bg-ink-600 disabled:opacity-50"
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

      {/* Заготовка → библия: имя уже есть, остальное можно дозаполнить позже */}
      <Sheet
        open={Boolean(newFor)}
        onClose={() => setNewFor(null)}
        title={`${t("В библию", "Add to bible")} · ${newFor ?? ""}`}
      >
        {newFor && (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-[11.5px] leading-relaxed text-t400">
              {t(
                "Этого персонажа назвал сюжет, но в библии его нет — значит, у него не будет референса, и видеомодель нарисует его случайным. Заведите его здесь: чип станет обычным во всех группах эпизода, где встречается это имя. Референс и внешность можно добавить позже в «Библии».",
                "The story named this character but the bible has no entry — so they have no reference and the video model will invent them. Create them here: the chip turns normal in every group of the episode that mentions this name. Reference and looks can be added later in the Bible.",
              )}
            </p>
            <label className="flex flex-col gap-1">
              <span className="section-label">{t("Внешность (EN, коротко)", "Looks (EN, short)")}</span>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder={t(
                  "напр. «tired woman in her 40s, short dark hair» — можно оставить пустым",
                  "e.g. “tired woman in her 40s, short dark hair” — may be left empty",
                )}
                className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="section-label">{t("Базовый гардероб (EN)", "Base wardrobe (EN)")}</span>
              <textarea
                value={newWardrobe}
                onChange={(e) => setNewWardrobe(e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder={t(
                  "напр. «light blue scrubs» — уйдёт в промпты как одежда по умолчанию",
                  "e.g. “light blue scrubs” — goes into prompts as the default outfit",
                )}
                className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
              />
            </label>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await createEntityFromUnlinked({
                    shotId,
                    name: newFor,
                    description: newDesc,
                    wardrobe: newWardrobe,
                  });
                  if (res.ok) {
                    toast(t(`${newFor} добавлен в библию`, `${newFor} added to the bible`));
                    setNewFor(null);
                    router.refresh();
                  } else toast(res.error);
                })
              }
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? t("Создание…", "Creating…") : t("Добавить в библию", "Add to bible")}
            </button>
          </div>
        )}
      </Sheet>

      {/* Одежда персонажа в группе: 2 блока (библия / сценарий) + выбор источника */}
      <Sheet
        open={Boolean(outfitFor)}
        onClose={() => setOutfitFor(null)}
        title={`${t("Одежда в группе", "Outfit in this group")} · ${outfitFor?.name ?? ""}`}
      >
        {outfitFor && (
          <div className="flex flex-col gap-4 pb-2">
            {/* Блок 1 — одежда из библии (read-only, меняется в Библии) */}
            <div className="flex flex-col gap-1.5">
              <div className="section-label">{t("1 · Одежда из библии", "1 · Bible wardrobe")}</div>
              <div className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t200">
                {outfitFor.wardrobe || (
                  <span className="text-t400">
                    {t("не задан — укажите в разделе «Библия»", "not set — add it in the Bible section")}
                  </span>
                )}
              </div>
            </div>

            {/* Блок 2 — сценарная одежда (из разбивки/ручная), пусто если не генерировалась */}
            <div className="flex flex-col gap-1.5">
              <div className="section-label">{t("2 · Одежда из сценария", "2 · Scene wardrobe")}</div>
              <textarea
                value={outfitText}
                onChange={(e) => setOutfitText(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={t(
                  "Пусто — одежда не описана в сюжете, берётся из библии. Можно вписать наряд вручную (на английском).",
                  "Empty — not described in the story, taken from the bible. You can type an outfit manually (in English).",
                )}
                className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
              />
            </div>

            {/* Переключатель источника для промпта */}
            <div className="flex flex-col gap-1.5">
              <div className="section-label">{t("В финальный промпт", "Into the final prompt")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "bible", ru: "Из библии", en: "Bible" },
                    { id: "generated", ru: "Сценарная", en: "Scene" },
                  ] as const
                ).map((opt) => {
                  const active = source === opt.id;
                  const disabled = opt.id === "generated" && !outfitText.trim();
                  return (
                    <button
                      key={opt.id}
                      onClick={() => !disabled && setSource(opt.id)}
                      disabled={disabled}
                      className="min-h-11 rounded-lg border px-3 text-[12px] font-semibold disabled:opacity-40"
                      style={{
                        borderColor: active ? "var(--violet-400)" : "var(--border-subtle)",
                        background: active ? "rgba(139,95,176,.14)" : "transparent",
                        color: active ? "var(--text-100)" : "var(--text-300)",
                      }}
                    >
                      {t(opt.ru, opt.en)}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-t400">
              {t(
                "По умолчанию одежда берётся из библии. Сценарный наряд появляется, только если сюжет описал внешний вид в этой сцене — тогда переключатель встаёт на «Сценарная». Выбранный вариант уходит в промпт (WARDROBE LOCK) для всех шотов группы.",
                "By default clothing comes from the bible. A scene outfit appears only when the story described the look in this scene — then the switch defaults to “Scene”. The chosen one goes into the prompt (WARDROBE LOCK) for every shot of the group.",
              )}
            </p>

            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setShotEntityOutfit(shotId, outfitFor.id, outfitText, source);
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
