"use client";

/**
 * Библиотека режиссёрских приёмов на вкладке «База знаний» (сид JSFilmz Vault +
 * свои карточки). Приём — такая же методичка промпт-фабрики, как документ, только
 * структурированная: Enhance видит их индекс и закрепляет подходящий за шотом, а
 * промпт-фабрика вплетает его камеру и оптику в SHOT-блок.
 *
 * Выключатель ОДИН на всю библиотеку (settings.techniques_enabled): выключено —
 * приёмы не уходят в модель совсем, но карточки и закрепления сохраняются.
 */
import { useMemo, useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import Toggle from "@/components/knowledge/Toggle";
import { toast } from "@/components/Toaster";
import {
  saveTechnique,
  deleteTechnique,
  deleteAllTechniques,
  toggleTechniquesEnabled,
} from "@/lib/actions/settingsPage";
import { useT } from "@/components/I18nProvider";

export interface TechniqueCard {
  id: string;
  title: string;
  category: string;
  camera: string;
  lens: string;
  lighting: string;
  tags: string;
  prompt: string;
  negative: string;
  custom: boolean;
}

const PAGE = 60;

export default function TechniquesLibrary({
  techniques,
  enabled,
}: {
  techniques: TechniqueCard[];
  enabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<TechniqueCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TechniqueCard | null>(null);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(
    () => [...new Set(techniques.map((x) => x.category).filter(Boolean))].sort(),
    [techniques],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return techniques.filter((x) => {
      if (category && x.category !== category) return false;
      if (!q) return true;
      return `${x.title} ${x.tags} ${x.camera} ${x.prompt}`.toLowerCase().includes(q);
    });
  }, [techniques, query, category]);

  function toggleLibrary() {
    startTransition(async () => {
      await toggleTechniquesEnabled(!enabled);
      toast(
        !enabled
          ? t("Приёмы включены — снова доступны модели", "Techniques enabled — available to the model again")
          : t("Приёмы выключены — в модель не уходят", "Techniques disabled — not sent to the model"),
      );
    });
  }

  function openNew() {
    setDraft({
      id: "",
      title: "",
      category: "Свои приёмы",
      camera: "",
      lens: "",
      lighting: "",
      tags: "",
      prompt: "",
      negative: "",
      custom: true,
    });
    setEditing(true);
    setSelected(null);
  }

  function submitDraft() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveTechnique({
        id: draft.id || undefined,
        title: draft.title,
        category: draft.category,
        prompt: draft.prompt,
        negative: draft.negative,
        camera: draft.camera,
        lens: draft.lens,
        lighting: draft.lighting,
        tags: draft.tags,
      });
      if (res.ok) {
        toast(draft.id ? t("Приём обновлён", "Technique updated") : t("Приём добавлен", "Technique added"));
        setEditing(false);
        setDraft(null);
      } else toast(("error" in res && res.error) || t("Ошибка", "Error"));
    });
  }

  return (
    <>
      {/* Выключатель — один на всю библиотеку; рядом спойлер со списком карточек */}
      <div className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3">
        <Toggle
          enabled={enabled}
          pending={pending}
          onToggle={toggleLibrary}
          title={
            enabled
              ? t("Выключить приёмы (не отправлять в модель)", "Disable techniques (do not send to the model)")
              : t("Включить приёмы", "Enable techniques")
          }
        />
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          <span className="text-[13px] leading-none" style={{ opacity: enabled ? 1 : 0.45 }}>
            🎥
          </span>
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: enabled ? "var(--text-300)" : "var(--text-400)" }}
          >
            {t("Режиссёрские приёмы", "Director techniques")} · {techniques.length}
            {!enabled && <span> · {t("выключены", "off")}</span>}
          </span>
          <span className="flex-1" />
          <span className="text-[10px] text-t400">{open ? "▴" : "▾"}</span>
        </button>
      </div>
      {!enabled && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2 text-[10.5px] leading-relaxed text-t400">
          {t(
            "Библиотека выключена: приёмы не уходят в модель совсем — Enhance их не видит и не закрепляет, в промпт шота они не вплетаются, пикер на карточке шота пуст. Карточки и закрепления сохраняются: включите обратно — всё заработает как было.",
            "The library is off: techniques are not sent to the model at all — Enhance neither sees nor attaches them, they are not woven into shot prompts, and the shot-card picker is empty. Cards and attachments are kept: switch it back on and everything works as before.",
          )}
        </div>
      )}

      {open && (
        <>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-t400">
              <span className="text-violet-600">✦</span>&nbsp;{" "}
              {t(
                "Enhance видит приёмы списком и закрепляет подходящий за шотом; в промпт уходит только камера и оптика приёма. Использованные видны бейджами 🎥 под промптом шота.",
                "Enhance sees the techniques as a list and attaches a fitting one to a shot; only the technique's camera and optics reach the prompt. Used ones show as 🎥 badges under the shot prompt.",
              )}
            </div>
            <span className="flex shrink-0 items-center gap-3">
              {techniques.length > 0 && (
                <ConfirmButton
                  action={deleteAllTechniques}
                  label={t("удалить все", "delete all")}
                  confirmLabel={t(`Удалить все приёмы (${techniques.length})?`, `Delete all techniques (${techniques.length})?`)}
                  doneToast={t("Приёмы удалены", "Techniques deleted")}
                  className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-t400 hover:text-danger disabled:opacity-50"
                  armedClassName="text-danger"
                />
              )}
              <button
                onClick={openNew}
                className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-violet-200 hover:text-violet-100"
              >
                {t("+ Добавить приём", "+ Add technique")}
              </button>
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder={t("Поиск по названию, тегам, тексту…", "Search by title, tags, text…")}
              className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLimit(PAGE);
              }}
              className="min-h-10 rounded-lg border border-[var(--border-default)] bg-ink-600 px-2 text-[11.5px] text-t100 outline-none"
            >
              <option value="">{t("Все категории", "All categories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            {filtered.slice(0, limit).map((card) => (
              <button
                key={card.id}
                onClick={() => setSelected(card)}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 text-left hover:border-[var(--border-strong)]"
                style={{ opacity: enabled ? 1 : 0.55 }}
              >
                <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-ink-600 text-[13px]">
                  🎥
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-t100">{card.title}</span>
                  <span className="mt-0.5 block truncate font-mono text-[9px] text-t400">
                    {card.category}
                    {card.camera ? ` · ${card.camera}` : ""}
                    {card.custom ? ` · ${t("свой", "custom")}` : ""}
                  </span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-[11px] text-t400">
                {t("Ничего не найдено", "Nothing found")}
              </div>
            )}
            {filtered.length > limit && (
              <button
                onClick={() => setLimit((v) => v + PAGE)}
                className="min-h-10 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t300 hover:bg-ink-600"
              >
                {t(`Показать ещё (${filtered.length - limit})`, `Show more (${filtered.length - limit})`)}
              </button>
            )}
          </div>
        </>
      )}

      {/* Просмотр приёма */}
      <Sheet open={Boolean(selected) && !editing} onClose={() => setSelected(null)} title={selected?.title ?? ""}>
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {[selected.category, selected.camera, selected.lens, selected.lighting]
                .filter(Boolean)
                .map((m) => (
                  <span
                    key={m}
                    className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300"
                  >
                    {m}
                  </span>
                ))}
            </div>
            {selected.tags && (
              <div className="font-mono text-[10px] text-t400">
                #{selected.tags.split(",").map((x) => x.trim()).join(" #")}
              </div>
            )}
            <div className="text-[10px] leading-relaxed text-t400">
              {t(
                "В промпт шота уходит только камера и оптика приёма — текст ниже задаёт его язык для Enhance, дословно в промпт не копируется.",
                "Only the technique's camera and optics reach the shot prompt — the text below defines its language for Enhance and is not copied verbatim.",
              )}
            </div>
            <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[11px] leading-relaxed text-t200">
              {selected.prompt}
            </div>
            {selected.negative && (
              <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t400">
                negative: {selected.negative}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft({ ...selected });
                  setEditing(true);
                  setSelected(null);
                }}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500"
              >
                {t("✎ Править", "✎ Edit")}
              </button>
              <ConfirmButton
                action={async () => {
                  await deleteTechnique(selected.id);
                  setSelected(null);
                }}
                label={t("Удалить", "Delete")}
                confirmLabel={t("Точно удалить приём?", "Really delete this technique?")}
                doneToast={t("Приём удалён", "Technique deleted")}
                className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </Sheet>

      {/* Редактирование / создание приёма */}
      <Sheet
        open={editing}
        onClose={() => {
          setEditing(false);
          setDraft(null);
        }}
        title={draft?.id ? t("Правка приёма", "Edit technique") : t("Новый приём", "New technique")}
      >
        {draft && (
          <div className="flex flex-col gap-2 pb-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("Название приёма", "Technique title")}
              className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <div className="flex gap-2">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder={t("Категория", "Category")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <input
                value={draft.camera}
                onChange={(e) => setDraft({ ...draft, camera: e.target.value })}
                placeholder={t("Камера (напр. Steadicam)", "Camera (e.g. Steadicam)")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={draft.lens}
                onChange={(e) => setDraft({ ...draft, lens: e.target.value })}
                placeholder={t("Оптика (напр. 35mm)", "Lens (e.g. 35mm)")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <input
                value={draft.lighting}
                onChange={(e) => setDraft({ ...draft, lighting: e.target.value })}
                placeholder={t("Свет (напр. low-key)", "Lighting (e.g. low-key)")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
            </div>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder={t("Теги через запятую (one-take, chase…)", "Comma-separated tags (one-take, chase…)")}
              className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 font-mono text-[11px] text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={7}
              placeholder={t("Текст приёма (английский промпт)…", "Technique text (English prompt)…")}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.negative}
              onChange={(e) => setDraft({ ...draft, negative: e.target.value })}
              rows={3}
              placeholder={t("Negative prompt (по желанию)…", "Negative prompt (optional)…")}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-t400 outline-none focus:border-[var(--border-strong)]"
            />
            <button
              onClick={submitDraft}
              disabled={pending || !draft.title.trim() || !draft.prompt.trim()}
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? t("Сохранение…", "Saving…") : t("Сохранить приём", "Save technique")}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
