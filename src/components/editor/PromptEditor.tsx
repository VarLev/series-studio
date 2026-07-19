"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  revisePrompt,
  saveManualVersion,
  generateShotPrompt,
  latestPromptVersion,
  cancelPromptGen,
} from "@/lib/actions/prompts";
import { useLongAction } from "@/components/useLongAction";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { PromptVersion } from "@/components/shot/PromptBlock";

/** Простой построчный diff (LCS) для режима «показать отличия». */
function diffLines(a: string, b: string): Array<{ text: string; kind: "same" | "add" | "del" }> {
  const A = a.split("\n");
  const B = b.split("\n");
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ text: string; kind: "same" | "add" | "del" }> = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      out.push({ text: A[i], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ text: A[i], kind: "del" });
      i++;
    } else {
      out.push({ text: B[j], kind: "add" });
      j++;
    }
  }
  while (i < A.length) out.push({ text: A[i++], kind: "del" });
  while (j < B.length) out.push({ text: B[j++], kind: "add" });
  return out;
}

export interface MentionItem {
  token: string;
  name: string;
  sub: string;
}

/** @-упоминание перед курсором (spec §2.4). */
function findMention(text: string, caret: number): { query: string; atIndex: number } | null {
  let i = caret - 1;
  while (i >= 0 && /[\wА-Яа-яЁё-]/.test(text[i])) i--;
  if (i < 0 || text[i] !== "@") return null;
  if (i > 0 && !/\s/.test(text[i - 1])) return null;
  return { query: text.slice(i + 1, caret), atIndex: i };
}

export default function PromptEditor({
  shotId,
  episodeId,
  versions,
  insertEntities,
  seriesRefs = [],
  initialNote = "",
  initialVersionId = "",
}: {
  shotId: string;
  episodeId: string;
  versions: PromptVersion[];
  insertEntities: Array<{ name: string; elementName: string }>;
  seriesRefs?: Array<{ token: string; caption: string }>;
  initialNote?: string;
  initialVersionId?: string;
}) {
  const router = useRouter();
  const t = useT();
  const [selectedId, setSelectedId] = useState(
    () => versions.find((v) => v.id === initialVersionId)?.id ?? versions[0]?.id ?? "",
  );
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const [text, setText] = useState(selected?.text ?? "");
  const [caret, setCaret] = useState(0);
  const [note, setNote] = useState(initialNote);
  const [diffMode, setDiffMode] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // реворк и первая генерация создают версию в БД долгим LLM-вызовом — ответ может
  // потеряться в туннеле; поллим latestPromptVersion и финишируем сами (useLongAction)
  const verWatch = useLongAction<number>();
  const startingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latest = versions[0];
  const busy = pending || verWatch.busy;

  // Отмена генерации промпта: сервер отбросит результат текущей epoch (версия не
  // создастся, на данные не повлияет), клиент перестаёт ждать. Сразу после этого
  // можно запустить новую задачу — у неё будет своя epoch.
  function cancelGen() {
    void cancelPromptGen(shotId);
    verWatch.cancel();
    toast(t("Генерация промпта отменена", "Prompt generation cancelled"));
  }

  const mention = useMemo(() => findMention(text, caret), [text, caret]);
  const mentionItems: MentionItem[] = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const all: MentionItem[] = [
      ...insertEntities.map((e) => ({
        token: e.elementName,
        name: e.name,
        sub: t("сущность", "entity"),
      })),
      ...seriesRefs.map((r) => ({
        token: r.token,
        name: r.caption || r.token,
        sub: t("референс серии", "episode reference"),
      })),
    ];
    return all
      .filter((i) => !q || i.token.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [mention, insertEntities, seriesRefs, t]);

  const diff = useMemo(() => {
    if (!diffMode || !selected) return [];
    // spec §2.4: diff против родителя (v(N−1))
    const prev = versions.find((v) => v.version === selected.version - 1);
    return prev ? diffLines(prev.text, selected.text) : [];
  }, [diffMode, selected, versions]);

  function pickVersion(id: string) {
    const v = versions.find((x) => x.id === id);
    if (!v) return;
    setSelectedId(id);
    setText(v.text);
  }

  function syncCaret() {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  }

  /** Вставка с авто-пробелами (spec §2.4). */
  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : after ? "" : " ";
    const inserted = prefix + snippet + suffix;
    const next = before + inserted + after;
    setText(next);
    const pos = start + inserted.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = pos;
    });
  }

  /** Вставка токена из @-упоминания — заменяет @query. */
  function pickMention(item: MentionItem) {
    if (!mention) return;
    const el = textareaRef.current;
    const before = text.slice(0, mention.atIndex);
    const after = text.slice(caret);
    const suffix = after && !/^\s/.test(after) ? " " : after ? "" : " ";
    const next = before + item.token + suffix + after;
    setText(next);
    const pos = before.length + item.token.length + suffix.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = pos;
    });
  }

  function insertAtSign() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const before = text.slice(0, start);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const next = before + prefix + "@" + text.slice(start);
    setText(next);
    const pos = start + prefix.length + 1;
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = pos;
    });
  }

  /** Финиш реворка/генерации: версия появилась в БД (по ответу ИЛИ по поллингу). */
  function versionDone(v: number) {
    toast(t(`Версия v${v} создана`, `Version v${v} created`));
    router.push(`/episodes/${episodeId}/shots/${shotId}`);
  }

  async function makeVersion() {
    if (!note.trim()) {
      setError(t("Напишите замечание — что исправить в новой версии", "Write a note — what to fix in the new version"));
      return;
    }
    if (!latest) return;
    // защита от двойного тапа: до verWatch.start есть await за ориентиром,
    // busy в этом окне ещё false
    if (startingRef.current || verWatch.busy) return;
    startingRef.current = true;
    setError("");
    // свежий ориентир с сервера: пропсовые versions могли устареть
    const baseline = await latestPromptVersion(shotId).catch(() => latest.version);
    startingRef.current = false;
    const epoch = crypto.randomUUID();
    verWatch.start({
      run: async () => {
        const res = await revisePrompt(latest.id, note.trim(), epoch);
        return res.ok ? { ok: true, value: baseline + 1 } : res;
      },
      poll: async () => {
        const v = await latestPromptVersion(shotId);
        return v > baseline ? { ok: true, value: v } : null;
      },
      pollMs: 4000,
      ceilingSec: 300,
      ceilingMsg: t(
        "Ответа нет дольше 5 минут. Версия могла не создаться — вернитесь на карточку шота и проверьте.",
        "No response for over 5 minutes. The version may not have been created — go back to the shot card and check.",
      ),
      onOk: versionDone,
      onErr: setError,
    });
  }

  function saveAsIs() {
    if (text === selected?.text) {
      toast(t("Изменений нет", "No changes"));
      return;
    }
    setError("");
    startTransition(async () => {
      const res = latest
        ? await saveManualVersion(latest.id, text, note.trim() || "Ручная правка")
        : { ok: false as const, error: t("Сначала сгенерируйте первую версию", "Generate the first version first") };
      if (!res.ok) setError(res.error);
      else {
        toast(t(`Сохранено как v${(latest?.version ?? 0) + 1} · ручная правка`, `Saved as v${(latest?.version ?? 0) + 1} · manual edit`));
        router.push(`/episodes/${episodeId}/shots/${shotId}`);
      }
    });
  }

  if (!versions.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-[13px] leading-relaxed text-t300">
          <span className="text-violet-600">✦</span>&nbsp;{" "}
          {t(
            "Версий ещё нет — сгенерируйте первую на карточке шота или прямо здесь.",
            "No versions yet — generate the first one on the shot card or right here.",
          )}
        </div>
        <button
          onClick={() => {
            // повторное нажатие во время работы — отмена: результат отбросится, можно
            // сразу запустить новую задачу
            if (verWatch.busy) {
              cancelGen();
              return;
            }
            setError("");
            // первая версия из редактора — трек Seedance (Kling создаётся на карточке
            // шота); версий ещё нет, поэтому успех = появилась хоть одна (поллинг)
            const epoch = crypto.randomUUID();
            verWatch.start({
              run: async () => {
                const res = await generateShotPrompt(shotId, "seedance-2.0", undefined, epoch);
                return res.ok ? { ok: true, value: 1 } : res;
              },
              poll: async () => {
                const v = await latestPromptVersion(shotId);
                return v > 0 ? { ok: true, value: v } : null;
              },
              pollMs: 4000,
              ceilingSec: 300,
              ceilingMsg: t(
                "Ответа нет дольше 5 минут. Промпт мог не создаться — попробуйте ещё раз.",
                "No response for over 5 minutes. The prompt may not have been created — try again.",
              ),
              onOk: () => router.refresh(),
              onErr: setError,
            });
          }}
          disabled={pending}
          title={verWatch.busy ? t("Идёт сборка — нажмите, чтобы перестать ждать", "Building — click to stop waiting") : undefined}
          className="min-h-12 rounded-lg bg-violet-500 px-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {verWatch.busy
            ? t(`Отменить · ${verWatch.elapsed}с`, `Cancel · ${verWatch.elapsed}s`)
            : t("Собрать промпт · Claude", "Build prompt · Claude")}
        </button>
        {error && <div className="text-[11px] text-danger">{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* переключатель версий + режим отличий */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] px-3 py-2">
        {[...versions].reverse().map((v) => (
          <button
            key={v.id}
            onClick={() => pickVersion(v.id)}
            className="min-h-[30px] shrink-0 rounded-md border px-2.5 font-mono text-[11px] font-semibold"
            style={{
              borderColor: v.id === selectedId ? "rgba(178,95,208,.5)" : "var(--border-subtle)",
              background: v.id === selectedId ? "rgba(178,95,208,.12)" : "none",
              color: v.id === selectedId ? "var(--magenta-400)" : "var(--text-300)",
            }}
          >
            v{v.version}
          </button>
        ))}
        <span className="flex-1" />
        {selected && selected.version > 1 && (
          <button
            onClick={() => setDiffMode((v) => !v)}
            className="min-h-[30px] shrink-0 rounded-md border px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              borderColor: diffMode ? "var(--border-strong)" : "var(--border-subtle)",
              background: diffMode ? "var(--ink-600)" : "none",
              color: diffMode ? "var(--text-100)" : "var(--text-300)",
            }}
          >
            {t("Отличия", "Diff")}
          </button>
        )}
      </div>

      {/* тело: diff или редактор */}
      {diffMode ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-ink-900 p-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-t400">
            v{selected!.version - 1} → v{selected!.version}
          </div>
          {diff.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap break-words border-l-2 px-2 py-px font-mono text-[11.5px] leading-[1.7]"
              style={{
                borderColor:
                  line.kind === "add"
                    ? "var(--success)"
                    : line.kind === "del"
                      ? "var(--danger)"
                      : "transparent",
                background:
                  line.kind === "add"
                    ? "rgba(79,143,125,.08)"
                    : line.kind === "del"
                      ? "rgba(194,71,106,.08)"
                      : "none",
                color:
                  line.kind === "same"
                    ? "var(--text-400)"
                    : line.kind === "del"
                      ? "#e08aa4"
                      : "var(--text-100)",
                textDecoration: line.kind === "del" ? "line-through" : "none",
              }}
            >
              {line.text || " "}
            </div>
          ))}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? 0);
            }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            spellCheck={false}
            autoCapitalize="off"
            className="min-h-0 w-full flex-1 resize-none bg-ink-900 p-3.5 font-mono text-[12px] leading-[1.75] text-t100 outline-none"
            style={{ caretColor: "var(--violet-100)" }}
          />
          {/* @-упоминания (spec §2.4): сущности библии + референсы серии */}
          {mention && (
            <div
              className="absolute inset-x-2 bottom-2 z-10 max-h-52 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-ink-700"
              style={{ boxShadow: "var(--shadow-lg)" }}
            >
              <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-[var(--border-subtle)] bg-ink-700 px-3 py-2">
                <span className="font-mono text-[10px] font-semibold text-magenta-400">
                  @{mention.query}
                </span>
                <span className="flex-1" />
                <span className="text-[9px] text-t400">{t("сущности · референсы серии", "entities · episode references")}</span>
              </div>
              {mentionItems.map((item) => (
                <button
                  key={item.token}
                  onClick={() => pickMention(item)}
                  className="flex min-h-11 w-full items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left hover:bg-ink-600"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-t100">
                      {item.name}
                    </span>
                    <span className="block text-[9px] text-t400">{item.sub}</span>
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-violet-200">
                    {item.token}
                  </span>
                </button>
              ))}
              {!mentionItems.length && (
                <div className="px-3 py-2.5 text-[10.5px] text-t400">
                  {t(
                    "Ничего не найдено — продолжайте набирать или закройте @ пробелом.",
                    "Nothing found — keep typing or close the @ with a space.",
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ленты быстрых вставок */}
      <div className="border-t border-[var(--border-subtle)] bg-ink-800 py-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-1.5">
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
            {t("Сущности", "Entities")}
          </span>
          <button
            onClick={insertAtSign}
            className="min-h-7 shrink-0 rounded-md border border-[rgba(178,95,208,.32)] bg-[rgba(178,95,208,.08)] px-2.5 font-mono text-[10.5px] font-semibold text-magenta-400 hover:bg-[rgba(178,95,208,.16)]"
          >
            {t("@ вставить…", "@ insert…")}
          </button>
          {insertEntities.map((e) => (
            <button
              key={e.elementName}
              onClick={() => insertAtCursor(e.elementName)}
              className="min-h-7 shrink-0 rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2.5 font-mono text-[10px] font-semibold text-violet-200 hover:border-[var(--border-strong)]"
            >
              {e.elementName}
            </button>
          ))}
        </div>
      </div>

      {/* нижняя панель: замечание → новая версия / ручное сохранение */}
      <div
        className="flex flex-col gap-2 border-t border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 mb-[58px] lg:mb-0"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
      >
        {error && <div className="text-[11px] text-danger">{error}</div>}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={t(
            "Замечание для Claude — что исправить в новой версии?",
            "Note for Claude — what to fix in the new version?",
          )}
          className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex items-stretch gap-2">
          <button
            onClick={verWatch.busy ? cancelGen : makeVersion}
            disabled={pending}
            title={verWatch.busy ? t("Идёт генерация — нажмите, чтобы перестать ждать", "Generating — click to stop waiting") : undefined}
            className="min-h-[46px] flex-1 rounded-md bg-violet-500 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {verWatch.busy
              ? t(`Отменить · ${verWatch.elapsed}с`, `Cancel · ${verWatch.elapsed}s`)
              : t(`Создать v${(latest?.version ?? 0) + 1}`, `Create v${(latest?.version ?? 0) + 1}`)}
          </button>
          <button
            onClick={saveAsIs}
            disabled={busy}
            className="min-h-[46px] rounded-md border border-[var(--border-default)] px-3 text-[10.5px] font-semibold leading-tight text-t200 hover:bg-ink-500 hover:text-t100 disabled:opacity-50"
          >
            {t("Сохранить", "Save")}
            <br />
            {t("как есть", "as is")}
          </button>
        </div>
      </div>
    </div>
  );
}
