"use client";

/**
 * Сквозное физическое состояние группы. Три вида чипов:
 *  - входящее (⟶) — факты, возникшие в ПРЕДЫДУЩИХ группах сцены и активные на
 *    00:00 этой группы; вычисляются свёрткой дифов (carriedStateAtStart). Живут
 *    в группе-источнике, поэтому по тапу можно «закончить здесь» (state_end этой
 *    группы) или удалить из всей сцены (removeSceneState);
 *  - начинается здесь (●) — state_begin этой группы, снимается крестиком;
 *  - заканчивается здесь (○) — state_end этой группы, снимается крестиком.
 * Тап по любому чипу — шторка с ПОЛНЫМ текстом и действиями (чипы обрезаны
 * коротко, замечание заказчика). «+» — новое состояние / конец входящего /
 * бэкфилл по эпизоду (GPT-5.6 Sol через Codex CLI, без CLI — дешёвая модель).
 * Инцидент-мотиватор: «рука на шее» из группы 3 пропадала из промпта группы 7.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { updateShotState, removeSceneState, extractCarriedState } from "@/lib/actions/shots";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

/** Половина прежней ширины: полный текст живёт в шторке по тапу. */
function truncate(s: string, n = 15): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

type Detail = { kind: "incoming" | "begin" | "end"; text: string };

export default function StateSection({
  shotId,
  episodeId,
  incoming,
  begin,
  end,
}: {
  shotId: string;
  episodeId: string;
  /** входящее состояние (вычислено сервером) — правится через шторку по тапу */
  incoming: string[];
  /** state_begin этой группы */
  begin: string[];
  /** state_end этой группы */
  end: string[];
}) {
  const t = useT();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [extracting, setExtracting] = useState(false);

  function run(fn: () => Promise<void>, done?: string) {
    // no-refresh: экшены уже делают revalidatePath — Next применит свежее
    // RSC-дерево из ответа экшена сам (паттерн якорей)
    startTransition(async () => {
      try {
        await fn();
        if (done) toast(done);
      } catch (err) {
        console.error("state action failed:", err);
        toast(t("Не удалось (сеть?) — попробуйте ещё раз", "Failed (network?) — try again"));
      }
    });
  }

  function addBegin() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setAddOpen(false);
    run(() => updateShotState(shotId, [...begin, text], end), t("Состояние добавлено", "State added"));
  }

  function endIncoming(text: string) {
    setAddOpen(false);
    setDetail(null);
    run(
      () => updateShotState(shotId, begin, [...end, text]),
      t("Отмечен конец состояния", "State end marked"),
    );
  }

  function removeFromScene(text: string) {
    setDetail(null);
    run(() => removeSceneState(shotId, text), t("Состояние удалено из сцены", "State removed from the scene"));
  }

  function removeBegin(text: string) {
    setDetail(null);
    run(
      () => updateShotState(shotId, begin.filter((x) => x !== text), end),
      t("Состояние убрано", "State removed"),
    );
  }

  function removeEnd(text: string) {
    setDetail(null);
    run(
      () => updateShotState(shotId, begin, end.filter((x) => x !== text)),
      t("Отметка конца убрана", "End mark removed"),
    );
  }

  function runExtract() {
    setAddOpen(false);
    setExtracting(true);
    startTransition(async () => {
      try {
        const res = await extractCarriedState(episodeId);
        if (res.ok) {
          toast(t("Сквозное состояние размечено по эпизоду", "Carried state extracted"));
          router.refresh();
        } else {
          toast(res.error);
        }
      } catch (err) {
        console.error("extractCarriedState failed:", err);
        toast(t("Не удалось (сеть?) — попробуйте ещё раз", "Failed (network?) — try again"));
      } finally {
        setExtracting(false);
      }
    });
  }

  const endedSet = new Set(end.map((s) => s.trim().toLowerCase()));
  const isEnded = (s: string) => endedSet.has(s.trim().toLowerCase());

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {incoming.map((s) => (
          <span
            key={`in-${s}`}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] bg-ink-700 py-1 pl-2.5 pr-1"
          >
            <button
              title={s}
              onClick={() => setDetail({ kind: "incoming", text: s })}
              className="inline-flex items-center gap-1.5 text-left"
            >
              <span className="text-[11px] leading-none text-violet-300">⟶</span>
              <span className="text-[12px] text-t300">{truncate(s)}</span>
              {isEnded(s) && (
                <span className="rounded-[3px] bg-[rgba(139,95,176,.14)] px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-300">
                  {t("конец", "ends")}
                </span>
              )}
            </button>
            {/* крестик — удалить входящий факт из всей сцены (как у entity) */}
            <button
              aria-label={t("Удалить из сцены", "Delete from the scene")}
              title={t("Удалить из сцены", "Delete from the scene")}
              disabled={pending}
              onClick={() => removeFromScene(s)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {begin.map((s) => (
          <span
            key={`b-${s}`}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-2 pr-1"
          >
            <button
              title={s}
              onClick={() => setDetail({ kind: "begin", text: s })}
              className="inline-flex items-center gap-1.5 text-left"
            >
              <span className="text-[11px] leading-none text-violet-300">●</span>
              <span className="text-[12px] text-t200">{truncate(s)}</span>
            </button>
            <button
              aria-label={t("Убрать состояние", "Remove state")}
              disabled={pending}
              onClick={() => removeBegin(s)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {end
          .filter((s) => !incoming.some((i) => i.trim().toLowerCase() === s.trim().toLowerCase()))
          .map((s) => (
            <span
              key={`e-${s}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-ink-600 py-1 pl-2 pr-1"
            >
              <button
                title={s}
                onClick={() => setDetail({ kind: "end", text: s })}
                className="inline-flex items-center gap-1.5 text-left"
              >
                <span className="text-[11px] leading-none text-t400">○</span>
                <span className="text-[12px] text-t300 line-through">{truncate(s)}</span>
              </button>
              <button
                aria-label={t("Убрать отметку конца", "Remove end mark")}
                disabled={pending}
                onClick={() => removeEnd(s)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        <button
          aria-label={t("Добавить состояние", "Add state")}
          onClick={() => setAddOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-[15px] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          {extracting ? "…" : "+"}
        </button>
        {/* пустое состояние: бэкфилл-кнопка видна сразу, а не только в шторке «+» —
            иначе фичу не найти на эпизодах, размеченных до её появления */}
        {incoming.length + begin.length + end.length === 0 && (
          <button
            disabled={pending || extracting}
            onClick={runExtract}
            className="inline-flex min-h-8 items-center rounded-full border border-dashed border-[var(--border-default)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200 disabled:opacity-50"
          >
            {extracting
              ? t("Разметка…", "Extracting…")
              : t("Разметить по эпизоду (ИИ)", "Extract for the whole episode (AI)")}
          </button>
        )}
      </div>

      {/* Полный текст состояния по тапу на чип + действия по его виду */}
      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={
          detail?.kind === "incoming"
            ? t("Входящее состояние", "Incoming state")
            : detail?.kind === "begin"
              ? t("Начинается в этой группе", "Begins in this group")
              : t("Заканчивается в этой группе", "Ends in this group")
        }
      >
        {detail && (
          <div className="flex flex-col gap-4 pb-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] leading-relaxed text-t100">
              {detail.text}
            </div>
            {detail.kind === "incoming" && (
              <div className="text-[11px] leading-relaxed text-t400">
                {t(
                  "Факт возник в одной из предыдущих групп сцены и активен на старте этой.",
                  "The fact began in an earlier group of the scene and is active at the start of this one.",
                )}
              </div>
            )}
            <div className="flex gap-2">
              {detail.kind === "incoming" && !isEnded(detail.text) && (
                <button
                  disabled={pending}
                  onClick={() => endIncoming(detail.text)}
                  className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-[0.08em] text-t200 hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  {t("Заканчивается здесь", "Ends here")}
                </button>
              )}
              {detail.kind === "incoming" && (
                <button
                  disabled={pending}
                  onClick={() => removeFromScene(detail.text)}
                  className="min-h-10 flex-1 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold uppercase tracking-[0.08em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
                >
                  {t("Удалить из сцены", "Delete from the scene")}
                </button>
              )}
              {detail.kind === "begin" && (
                <button
                  disabled={pending}
                  onClick={() => removeBegin(detail.text)}
                  className="min-h-10 flex-1 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold uppercase tracking-[0.08em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
                >
                  {t("Убрать состояние", "Remove state")}
                </button>
              )}
              {detail.kind === "end" && (
                <button
                  disabled={pending}
                  onClick={() => removeEnd(detail.text)}
                  className="min-h-10 flex-1 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold uppercase tracking-[0.08em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
                >
                  {t("Убрать отметку конца", "Remove end mark")}
                </button>
              )}
            </div>

            {/* Легенда иконок чипов — что означают и как получить */}
            <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
              <div className="section-label">{t("Обозначения", "Legend")}</div>
              <div className="flex items-start gap-2 text-[11px] leading-relaxed text-t400">
                <span className="w-4 shrink-0 text-center text-violet-300">⟶</span>
                <span>
                  {t(
                    "Входящее — факт возник в предыдущей группе сцены и активен здесь. Появляется сам, отдельно добавлять не нужно.",
                    "Incoming — the fact began in an earlier group of the scene and is active here. Appears automatically, no need to add it.",
                  )}
                </span>
              </div>
              <div className="flex items-start gap-2 text-[11px] leading-relaxed text-t400">
                <span className="w-4 shrink-0 text-center text-violet-300">●</span>
                <span>
                  {t(
                    "Начинается здесь — новый длящийся факт этой группы. Добавляется кнопкой «+» и разносится по следующим группам сцены.",
                    "Begins here — a new lasting fact of this group. Added via «+» and propagated to the following groups of the scene.",
                  )}
                </span>
              </div>
              <div className="flex items-start gap-2 text-[11px] leading-relaxed text-t400">
                <span className="w-4 shrink-0 text-center text-t400">○</span>
                <span>
                  {t(
                    "Заканчивается здесь — факт, отмеченный завершённым в этой группе (кнопка «Заканчивается здесь»). Дальше по сцене не разносится.",
                    "Ends here — a fact marked as over in this group (the «Ends here» button). Stops propagating through the scene.",
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
      </Sheet>

      {/* Панель «+»: новое состояние, конец входящего, бэкфилл по эпизоду */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t("Сквозное состояние", "Carried state")}>
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-col gap-1.5">
            <div className="section-label">
              {t("Начинается в этой группе", "Begins in this group")}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              autoFocus
              placeholder={t(
                "Длящийся факт, на английском (напр.: @Jacob's palm rests on @Simon's neck)",
                "A lasting fact, in English (e.g.: @Jacob's palm rests on @Simon's neck)",
              )}
              className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] leading-relaxed text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <button
              disabled={pending || !draft.trim()}
              onClick={addBegin}
              className="min-h-10 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {pending ? t("Сохранение…", "Saving…") : t("Добавить", "Add")}
            </button>
            <div className="text-[11px] leading-relaxed text-t400">
              {t(
                "Факт разнесётся по всем следующим группам сцены автоматически — до группы, где отмечен его конец.",
                "The fact propagates to every following group of the scene automatically — until the group where its end is marked.",
              )}
            </div>
          </div>

          {incoming.filter((s) => !isEnded(s)).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="section-label">
                {t("Заканчивается здесь — отметить конец входящего", "Ends here — mark an incoming fact as over")}
              </div>
              <div className="flex flex-col">
                {incoming
                  .filter((s) => !isEnded(s))
                  .map((s) => (
                    <button
                      key={s}
                      disabled={pending}
                      onClick={() => endIncoming(s)}
                      className="flex min-h-11 items-center gap-2 border-b border-[var(--border-subtle)] py-1.5 text-left hover:text-violet-100 disabled:opacity-50"
                    >
                      <span className="text-[11px] leading-none">○</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-t200">{s}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="section-label">{t("Разметка по эпизоду", "Episode-wide extraction")}</div>
            <button
              disabled={pending || extracting}
              onClick={runExtract}
              className="min-h-10 rounded-lg border border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-[0.08em] text-t200 hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              {extracting
                ? t("Разметка…", "Extracting…")
                : t("Разметить по эпизоду (ИИ)", "Extract for the whole episode (AI)")}
            </button>
            <div className="text-[11px] leading-relaxed text-t400">
              {t(
                "Модель прочитает все группы эпизода и разметит длящиеся факты заново (существующие отметки перезапишутся). При подключённом Codex CLI работает GPT-5.6 Sol по подписке; без CLI — дешёвая модель из настроек.",
                "The model reads every group of the episode and re-extracts lasting facts (existing marks are overwritten). With Codex CLI connected it runs GPT-5.6 Sol on your subscription; without CLI — the cheap model from settings.",
              )}
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
