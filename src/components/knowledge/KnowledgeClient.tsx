"use client";

/**
 * Вкладка «База знаний»: документы, которые промпт-фабрика подмешивает в
 * системный промпт при генерации и правке видео-промптов. Здесь их можно
 * просматривать, править, включать/выключать, загружать (файлами с устройства
 * или из папки /knowledge) и удалять.
 */
import { useRef, useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { EmptyState, SectionLabel } from "@/components/ui";
import KnowledgeIngest from "@/components/costs/KnowledgeIngest";
import Toggle from "@/components/knowledge/Toggle";
import { saveKnowledgeDoc, toggleKnowledgeDoc, uploadKnowledgeDocs } from "@/lib/actions/knowledge";
import { deleteKnowledgeDoc, clearKnowledge } from "@/lib/actions/deletes";
import { KNOWLEDGE_EXCERPT_CHARS } from "@/lib/knowledgeTags";
import { useT } from "@/components/I18nProvider";

export interface KnowledgeDocItem {
  id: string;
  title: string;
  sourceFile: string;
  contentMd: string;
  tags: string;
  enabled: boolean;
}

interface Draft {
  id: string; // "" — новый документ
  title: string;
  tags: string;
  contentMd: string;
}

/** На какой трек промптов документ попадёт по своим тегам (логика knowledgeContext). */
function useTrackLabel() {
  const t = useT();
  return (tags: string): string => {
    const low = tags.toLowerCase();
    const sd = low.includes("seedance");
    const kl = low.includes("kling");
    if (sd && kl) return "Seedance + Kling";
    if (sd) return "Seedance";
    if (kl) return "Kling";
    return t("оба трека", "both tracks");
  };
}

export default function KnowledgeClient({ docs }: { docs: KnowledgeDocItem[] }) {
  const t = useT();
  const trackLabel = useTrackLabel();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<KnowledgeDocItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(doc: KnowledgeDocItem) {
    startTransition(async () => {
      await toggleKnowledgeDoc(doc.id, !doc.enabled);
      toast(
        !doc.enabled
          ? t("Документ включён — снова уходит в промпты", "Document enabled — used in prompts again")
          : t("Документ выключен — в промпты не идёт", "Document disabled — not used in prompts"),
      );
    });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const payload = await Promise.all(
      files.map(async (f) => ({ name: f.name, content: await f.text() })),
    );
    input.value = "";
    startTransition(async () => {
      const res = await uploadKnowledgeDocs(payload);
      toast(res.message);
    });
  }

  function submitDraft() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveKnowledgeDoc({
        id: draft.id || undefined,
        title: draft.title,
        tags: draft.tags,
        contentMd: draft.contentMd,
      });
      if (res.ok) {
        toast(draft.id ? t("Документ сохранён", "Document saved") : t("Документ добавлен", "Document added"));
        setDraft(null);
      } else toast(("error" in res && res.error) || t("Ошибка", "Error"));
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-1">
      <SectionLabel hint={t("свободный текст · методичка сценариста", "free text · writer's handbook")}>
        {t("Документы", "Documents")}
      </SectionLabel>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5 text-[10.5px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp;{" "}
        {t(
          "Эти документы промпт-фабрика читает как методичку: при генерации и правке видео-промпта их текст подмешивается в задание ИИ-сценариста (в само видео они не уходят). Теги решают, какому треку достаётся документ: «seedance» / «kling» — только своему, «general» и «camera» — обоим. В промпт уходят только первые " ,
          "The prompt factory reads these documents as a handbook: when generating or revising a video prompt, their text is added to the prompt-writer AI's briefing (they are never sent to the video model itself). Tags decide which track gets a document: “seedance” / “kling” — that track only, “general” and “camera” — both. Only the first ",
        )}
        {KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")}
        {t(" символов каждого документа.", " characters of each document are used.")}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={pending}
          className="min-h-11 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:border-[var(--border-strong)] disabled:opacity-50"
        >
          {t("Загрузить файлы (.md, .txt)", "Upload files (.md, .txt)")}
        </button>
        <button
          onClick={() => setDraft({ id: "", title: "", tags: "", contentMd: "" })}
          disabled={pending}
          className="min-h-11 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:border-[var(--border-strong)] disabled:opacity-50"
        >
          {t("+ Новый документ", "+ New document")}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        multiple
        onChange={onFiles}
        className="hidden"
      />

      {docs.length ? (
        <div className="flex flex-col gap-1.5">
          {docs.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5"
            >
              <Toggle
                enabled={d.enabled}
                pending={pending}
                onToggle={() => toggle(d)}
                title={d.enabled ? t("Выключить (не использовать)", "Disable (do not use)") : t("Включить", "Enable")}
              />
              <button onClick={() => setSelected(d)} className="min-w-0 flex-1 text-left">
                <span
                  className="block truncate text-[12.5px] font-medium"
                  style={{ color: d.enabled ? "var(--text-100)" : "var(--text-400)" }}
                >
                  {d.title}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[9px] text-t400">
                  {trackLabel(d.tags)} · {d.contentMd.length.toLocaleString("ru-RU")}{" "}
                  {t("симв.", "chars")}
                  {d.contentMd.length > KNOWLEDGE_EXCERPT_CHARS && (
                    <span className="text-danger">
                      {" "}
                      · ✂ {t(`в промпт уйдут первые ${KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")}`, `only first ${KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")} used`)}
                    </span>
                  )}
                  {!d.enabled && <span> · {t("выключен", "disabled")}</span>}
                </span>
              </button>
              <span className="font-mono text-[9.5px] text-violet-300">{d.tags}</span>
            </div>
          ))}
          {docs.length > 1 && (
            <ConfirmButton
              action={clearKnowledge}
              label={t(`Очистить базу знаний (${docs.length})`, `Clear knowledge base (${docs.length})`)}
              confirmLabel={t("Точно очистить всю базу знаний?", "Really clear the whole knowledge base?")}
              doneToast={t("База знаний очищена", "Knowledge base cleared")}
              className="mt-1 min-h-10 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
            />
          )}
        </div>
      ) : (
        <EmptyState>
          {t(
            "Документов пока нет. Загрузите файлы с устройства, создайте документ вручную или положите .md в папку /knowledge и нажмите «Обновить базу знаний».",
            "No documents yet. Upload files from your device, create one manually, or put .md files into the /knowledge folder and press Refresh knowledge base.",
          )}
        </EmptyState>
      )}

      <KnowledgeIngest />
      <p className="text-[10px] leading-relaxed text-t400">
        {t(
          "«Обновить базу знаний» перечитывает папку /knowledge проекта: одноимённые документы обновляются (ручные правки их текста перезапишутся, состояние вкл/выкл сохранится).",
          "“Refresh knowledge base” re-reads the project's /knowledge folder: documents with the same name are updated (manual edits to their text will be overwritten; the on/off state is kept).",
        )}
      </p>

      {/* Просмотр документа */}
      <Sheet open={Boolean(selected) && !draft} onClose={() => setSelected(null)} title={selected?.title ?? ""}>
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300">
                {t("трек:", "track:")} {trackLabel(selected.tags)}
              </span>
              {selected.tags && (
                <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300">
                  #{selected.tags.split(",").map((x) => x.trim()).join(" #")}
                </span>
              )}
              <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300">
                {selected.contentMd.length.toLocaleString("ru-RU")} {t("симв.", "chars")}
              </span>
              <span
                className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px]"
                style={{ color: selected.enabled ? "var(--success)" : "var(--text-400)" }}
              >
                {selected.enabled ? t("включён", "enabled") : t("выключен", "disabled")}
              </span>
            </div>
            {selected.contentMd.length > KNOWLEDGE_EXCERPT_CHARS && (
              <div className="rounded-lg border border-[rgba(194,71,106,.35)] px-3 py-2 text-[10.5px] leading-relaxed text-danger">
                {t(
                  `Документ длиннее лимита: в промпт уходят только первые ${KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")} символов. Разбейте его на несколько документов, чтобы ничего не потерять.`,
                  `The document exceeds the limit: only the first ${KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")} characters reach the prompt. Split it into several documents to keep everything.`,
                )}
              </div>
            )}
            {selected.sourceFile && (
              <div className="text-[10px] leading-relaxed text-t400">
                {t("Источник: файл", "Source: file")} /knowledge/{selected.sourceFile} —{" "}
                {t(
                  "повторная загрузка папки или файла с этим именем перезапишет правки.",
                  "re-ingesting the folder or a file with this name will overwrite edits.",
                )}
              </div>
            )}
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[11px] leading-relaxed text-t200">
              {selected.contentMd}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft({
                    id: selected.id,
                    title: selected.title,
                    tags: selected.tags,
                    contentMd: selected.contentMd,
                  });
                  // как в TechniquesLibrary: снимок под view-шитом устарел в момент
                  // сохранения, и без сброса шит переоткрывался со СТАРЫМ текстом
                  setSelected(null);
                }}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500"
              >
                {t("✎ Править", "✎ Edit")}
              </button>
              <ConfirmButton
                action={async () => {
                  await deleteKnowledgeDoc(selected.id);
                  setSelected(null);
                }}
                label={t("Удалить", "Delete")}
                confirmLabel={t("Точно удалить документ?", "Really delete this document?")}
                doneToast={t("Документ удалён", "Document deleted")}
                className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </Sheet>

      {/* Правка / создание документа */}
      <Sheet
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("Правка документа", "Edit document") : t("Новый документ", "New document")}
      >
        {draft && (
          <div className="flex flex-col gap-2 pb-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("Название документа", "Document title")}
              className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder={t(
                "Теги через запятую: seedance / kling / general / camera (пусто — автоопределение)",
                "Comma-separated tags: seedance / kling / general / camera (empty = auto)",
              )}
              className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 font-mono text-[11px] text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.contentMd}
              onChange={(e) => setDraft({ ...draft, contentMd: e.target.value })}
              rows={16}
              spellCheck={false}
              placeholder={t("Текст документа (markdown)…", "Document text (markdown)…")}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <div
              className="text-right font-mono text-[9.5px]"
              style={{
                color:
                  draft.contentMd.length > KNOWLEDGE_EXCERPT_CHARS ? "var(--danger)" : "var(--text-400)",
              }}
            >
              {draft.contentMd.length.toLocaleString("ru-RU")} / {KNOWLEDGE_EXCERPT_CHARS.toLocaleString("ru-RU")}
            </div>
            <button
              onClick={submitDraft}
              disabled={pending || !draft.title.trim() || !draft.contentMd.trim()}
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? t("Сохранение…", "Saving…") : t("Сохранить документ", "Save document")}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
