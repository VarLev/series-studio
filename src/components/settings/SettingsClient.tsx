"use client";

/**
 * Настройки: два шаблона промптов (раскадровка / видео) и библиотека
 * режиссёрских приёмов (сид JSFilmz Vault + свои карточки).
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { saveTemplate, resetTemplate, saveTechnique, deleteTechnique } from "@/lib/actions/settingsPage";
import { SectionLabel } from "@/components/ui";

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

function TemplateEditor({
  settingKey,
  title,
  hint,
  initial,
}: {
  settingKey: "tpl_storyboard" | "tpl_video";
  title: string;
  hint: string;
  initial: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = value !== initial;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-ink-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-t100">{title}</span>
          <span className="mt-0.5 block text-[10.5px] leading-relaxed text-t400">{hint}</span>
        </span>
        <span className="text-t400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] p-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                startTransition(async () => {
                  const res = await saveTemplate(settingKey, value);
                  toast(res.ok ? "Шаблон сохранён" : ("error" in res && res.error) || "Ошибка");
                  router.refresh();
                })
              }
              disabled={pending || !dirty}
              className="min-h-10 flex-1 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {pending ? "Сохранение…" : dirty ? "Сохранить шаблон" : "Сохранено"}
            </button>
            <ConfirmButton
              action={async () => {
                await resetTemplate(settingKey);
                setValue(initial); // сервер отдаст стандартный после refresh
              }}
              label="Сбросить"
              confirmLabel="Вернуть стандартный?"
              doneToast="Шаблон сброшен к стандартному"
              className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold text-t300 hover:bg-ink-500 disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsClient({
  storyboardTemplate,
  videoTemplate,
  techniques,
}: {
  storyboardTemplate: string;
  videoTemplate: string;
  techniques: TechniqueCard[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<TechniqueCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TechniqueCard | null>(null);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(
    () => [...new Set(techniques.map((t) => t.category).filter(Boolean))].sort(),
    [techniques],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return techniques.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      return `${t.title} ${t.tags} ${t.camera} ${t.prompt}`.toLowerCase().includes(q);
    });
  }, [techniques, query, category]);

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

  function openEdit(t: TechniqueCard) {
    setDraft({ ...t });
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
        tags: draft.tags,
      });
      if (res.ok) {
        toast(draft.id ? "Приём обновлён" : "Приём добавлен");
        setEditing(false);
        setDraft(null);
        router.refresh();
      } else toast(("error" in res && res.error) || "Ошибка");
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-10">
      <SectionLabel>Шаблоны промптов</SectionLabel>
      <TemplateEditor
        settingKey="tpl_storyboard"
        title="Шаблон раскадровки (Nano Banana)"
        hint="Плейсхолдеры: {{GRID}}, {{PANELS}}, {{REFERENCES}}, {{STORY}}, {{PANEL_STRUCTURE}} — подставляются при сборке на вкладке «Раскадровка»."
        initial={storyboardTemplate}
      />
      <TemplateEditor
        settingKey="tpl_video"
        title="Шаблон видео-промпта (системный для Claude)"
        hint="Инструкция, по которой промпт-фабрика пишет мультишот-промпты для Seedance/Kling. Кнопка «Сгенерировать промпт» на карточке шота."
        initial={videoTemplate}
      />

      <SectionLabel
        right={
          <button
            onClick={openNew}
            className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-violet-200 hover:text-violet-100"
          >
            + Добавить приём
          </button>
        }
      >
        Режиссёрские приёмы · {techniques.length}
      </SectionLabel>
      <div className="text-[10.5px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp; Промпт-фабрика сама подбирает подходящие
        приёмы к каждому шоту и вплетает их в видео-промпт. Использованные приёмы видны бейджами 🎥
        под промптом шота.
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Поиск по названию, тегам, тексту…"
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
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        {filtered.slice(0, limit).map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t)}
            className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 text-left hover:border-[var(--border-strong)]"
          >
            <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-ink-600 text-[13px]">
              🎥
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-t100">{t.title}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-t400">
                {t.category}
                {t.camera ? ` · ${t.camera}` : ""}
                {t.custom ? " · свой" : ""}
              </span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-[11px] text-t400">
            Ничего не найдено
          </div>
        )}
        {filtered.length > limit && (
          <button
            onClick={() => setLimit((v) => v + PAGE)}
            className="min-h-10 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t300 hover:bg-ink-600"
          >
            Показать ещё ({filtered.length - limit})
          </button>
        )}
      </div>

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
              <div className="font-mono text-[10px] text-t400">#{selected.tags.split(",").map((t) => t.trim()).join(" #")}</div>
            )}
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
                onClick={() => openEdit(selected)}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500"
              >
                ✎ Править
              </button>
              <ConfirmButton
                action={async () => {
                  await deleteTechnique(selected.id);
                  setSelected(null);
                }}
                label="Удалить"
                confirmLabel="Точно удалить приём?"
                doneToast="Приём удалён"
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
        title={draft?.id ? "Правка приёма" : "Новый приём"}
      >
        {draft && (
          <div className="flex flex-col gap-2 pb-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Название приёма"
              className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <div className="flex gap-2">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder="Категория"
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <input
                value={draft.camera}
                onChange={(e) => setDraft({ ...draft, camera: e.target.value })}
                placeholder="Камера (напр. Steadicam)"
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
            </div>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="Теги через запятую (one-take, chase…)"
              className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 font-mono text-[11px] text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={7}
              placeholder="Текст приёма (английский промпт)…"
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.negative}
              onChange={(e) => setDraft({ ...draft, negative: e.target.value })}
              rows={3}
              placeholder="Negative prompt (по желанию)…"
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-t400 outline-none focus:border-[var(--border-strong)]"
            />
            <button
              onClick={submitDraft}
              disabled={pending || !draft.title.trim() || !draft.prompt.trim()}
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? "Сохранение…" : "Сохранить приём"}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
