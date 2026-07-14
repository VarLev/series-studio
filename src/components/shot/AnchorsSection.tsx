"use client";

/**
 * Якоря группы: короткие текстовые детали-инъекции (синяк на лице, цвет одежды,
 * предмет в кадре), которых не хватает референсам/энтити/тону. Чип с иконкой ⚓ и
 * обрезанным текстом; тап по чипу — полный текст, × — открепить от группы (якорь
 * остаётся в пуле эпизода). «+» открывает панель: ввод нового + список якорей
 * эпизода для переиспользования (прикрепить/удалить). Прикреплённые якоря —
 * ОБЯЗАТЕЛЬНЫЕ пометки в видео-промпте, Enhance и Rework.
 */
import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { createAnchor, attachAnchor, detachAnchor, deleteAnchor } from "@/lib/actions/anchors";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export interface AnchorItem {
  id: string;
  text: string;
  source: string; // manual | enhance
}

function truncate(s: string, n = 26): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

export default function AnchorsSection({
  shotId,
  attached,
  available,
}: {
  shotId: string;
  /** якоря, прикреплённые к этой группе */
  attached: AnchorItem[];
  /** якоря эпизода, ещё не прикреплённые к группе (для переиспользования) */
  available: AnchorItem[];
}) {
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const [detailFor, setDetailFor] = useState<AnchorItem | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>, done?: string) {
    // no-refresh: экшены якорей уже делают revalidatePath — Next применит свежее
    // RSC-дерево из ответа экшена сам, второй round-trip (router.refresh) не нужен
    startTransition(async () => {
      try {
        await fn();
        if (done) toast(done);
      } catch (err) {
        console.error("anchor action failed:", err);
        toast(t("Не удалось (сеть?) — попробуйте ещё раз", "Failed (network?) — try again"));
      }
    });
  }

  function addNew() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setAddOpen(false);
    run(() => createAnchor(shotId, text), t("Якорь добавлен", "Anchor added"));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {attached.map((a) => (
          <span
            key={a.id}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-2 pr-1"
            style={a.source === "enhance" ? { borderColor: "var(--violet-400)" } : undefined}
          >
            <button
              onClick={() => setDetailFor(a)}
              title={a.text}
              className="inline-flex items-center gap-1.5 text-left"
            >
              <span className="text-[11px] leading-none">⚓</span>
              <span className="text-[12px] text-t200">{truncate(a.text)}</span>
              {a.source === "enhance" && (
                <span className="rounded-[3px] bg-[rgba(139,95,176,.14)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-300">
                  ✨
                </span>
              )}
            </button>
            <button
              aria-label={t("Открепить якорь", "Detach anchor")}
              disabled={pending}
              onClick={() => run(() => detachAnchor(shotId, a.id))}
              className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        <button
          aria-label={t("Добавить якорь", "Add anchor")}
          onClick={() => setAddOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-[15px] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          +
        </button>
      </div>

      {/* Панель добавления: новый якорь + переиспользование существующих в эпизоде */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t("Якорь", "Anchor")}>
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-col gap-1.5">
            <div className="section-label">{t("Новый якорь", "New anchor")}</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              autoFocus
              placeholder={t(
                "Деталь в кадр (напр.: синяк на левой скуле, красный шарф, разбитая чашка на столе)",
                "A detail in frame (e.g.: bruise on the left cheek, red scarf, a broken cup on the table)",
              )}
              className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <button
              disabled={pending || !draft.trim()}
              onClick={addNew}
              className="min-h-10 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {pending ? t("Сохранение…", "Saving…") : t("Добавить", "Add")}
            </button>
          </div>

          {available.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="section-label">
                {t("Якоря эпизода — прикрепить к группе", "Episode anchors — attach to group")}
              </div>
              <div className="flex flex-col">
                {available.map((a) => (
                  <div
                    key={a.id}
                    className="flex min-h-11 items-center gap-2 border-b border-[var(--border-subtle)] py-1.5"
                  >
                    <button
                      disabled={pending}
                      onClick={() => {
                        setAddOpen(false);
                        run(() => attachAnchor(shotId, a.id), t("Якорь прикреплён", "Anchor attached"));
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-violet-100 disabled:opacity-50"
                    >
                      <span className="text-[11px] leading-none">⚓</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-t200">{a.text}</span>
                    </button>
                    <button
                      aria-label={t("Удалить из эпизода", "Delete from episode")}
                      disabled={pending}
                      onClick={() => run(() => deleteAnchor(shotId, a.id), t("Якорь удалён", "Anchor deleted"))}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-t400 hover:bg-ink-600 hover:text-danger disabled:opacity-50"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      {/* Полный текст якоря по тапу на чип */}
      <Sheet
        open={Boolean(detailFor)}
        onClose={() => setDetailFor(null)}
        title={t("Якорь", "Anchor")}
      >
        {detailFor && (
          <div className="flex flex-col gap-4 pb-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] leading-relaxed text-t100">
              {detailFor.text}
            </div>
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={() => {
                  const id = detailFor.id;
                  setDetailFor(null);
                  run(() => detachAnchor(shotId, id), t("Якорь откреплён", "Anchor detached"));
                }}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-[0.08em] text-t200 hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                {t("Открепить", "Detach")}
              </button>
              <button
                disabled={pending}
                onClick={() => {
                  const id = detailFor.id;
                  setDetailFor(null);
                  run(() => deleteAnchor(shotId, id), t("Якорь удалён", "Anchor deleted"));
                }}
                className="min-h-10 flex-1 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold uppercase tracking-[0.08em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
              >
                {t("Удалить из эпизода", "Delete from episode")}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
