"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revisePrompt, saveManualVersion, generateShotPrompt } from "@/lib/actions/prompts";
import type { PromptVersion } from "@/components/shot/PromptBlock";

/** Движения камеры (Kling Camera Toolkit) — быстрые вставки в позицию курсора. */
const CAMERA_MOVES = [
  "Slow dolly in",
  "Dolly out",
  "Crane up",
  "Crane down",
  "Orbit 360°",
  "Push-in + tilt up",
  "Handheld tracking shot",
  "Static locked-off shot",
  "Whip pan",
  "Slow zoom out reveal",
];

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

export default function PromptEditor({
  shotId,
  episodeId,
  versions,
  insertEntities,
}: {
  shotId: string;
  episodeId: string;
  versions: PromptVersion[];
  insertEntities: Array<{ name: string; elementName: string }>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(versions[0]?.id ?? "");
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const [text, setText] = useState(selected?.text ?? "");
  const [note, setNote] = useState("");
  const [diffMode, setDiffMode] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latest = versions[0];

  const diff = useMemo(() => {
    if (!diffMode || !selected) return [];
    const prev = versions.find((v) => v.version === selected.version - 1);
    return prev ? diffLines(prev.text, selected.text) : [];
  }, [diffMode, selected, versions]);

  function pickVersion(id: string) {
    const v = versions.find((x) => x.id === id);
    if (!v) return;
    setSelectedId(id);
    setText(v.text);
  }

  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + snippet);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + snippet.length;
    });
  }

  function makeVersion() {
    if (!note.trim() || !latest) return;
    setError("");
    startTransition(async () => {
      const res = await revisePrompt(latest.id, note.trim());
      if (!res.ok) setError(res.error);
      else router.push(`/episodes/${episodeId}/shots/${shotId}`);
    });
  }

  function saveAsIs() {
    setError("");
    startTransition(async () => {
      const res = latest
        ? await saveManualVersion(latest.id, text, note.trim())
        : { ok: false as const, error: "Сначала сгенерируйте первую версию" };
      if (!res.ok) setError(res.error);
      else router.push(`/episodes/${episodeId}/shots/${shotId}`);
    });
  }

  if (!versions.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-[13px] leading-relaxed text-t300">
          <span className="text-violet-600">✦</span>&nbsp; Версий ещё нет — сгенерируйте первую
          на карточке шота или прямо здесь.
        </div>
        <button
          onClick={() =>
            startTransition(async () => {
              const res = await generateShotPrompt(shotId, "kling-3.0");
              if (!res.ok) setError(res.error);
              else router.refresh();
            })
          }
          disabled={pending}
          className="min-h-12 rounded-lg bg-violet-500 px-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-60"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {pending ? "Фабрика работает…" : "Сгенерировать промпт (Kling 3.0)"}
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
            Отличия
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
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          className="min-h-0 w-full flex-1 resize-none bg-ink-900 p-3.5 font-mono text-[12px] leading-[1.75] text-t100 outline-none"
          style={{ caretColor: "var(--violet-100)" }}
        />
      )}

      {/* ленты быстрых вставок */}
      <div className="border-t border-[var(--border-subtle)] bg-ink-800 py-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-1.5">
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
            Сущности
          </span>
          {insertEntities.map((e) => (
            <button
              key={e.elementName}
              onClick={() => insertAtCursor(e.elementName)}
              className="min-h-7 shrink-0 rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2.5 font-mono text-[10px] font-semibold text-violet-200 hover:border-[var(--border-strong)]"
            >
              {e.elementName}
            </button>
          ))}
          {!insertEntities.length && (
            <span className="text-[10px] text-t400">нет сущностей у шота</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto px-3">
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
            Камера
          </span>
          {CAMERA_MOVES.map((m) => (
            <button
              key={m}
              onClick={() => insertAtCursor(m)}
              className="min-h-7 shrink-0 rounded-md border border-[var(--border-subtle)] bg-ink-600 px-2.5 font-mono text-[10px] text-t200 hover:border-[var(--border-strong)] hover:text-violet-100"
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* нижняя панель: замечание → новая версия / ручное сохранение */}
      <div
        className="flex flex-col gap-2 border-t border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
      >
        {error && <div className="text-[11px] text-danger">{error}</div>}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Замечание для Claude — что исправить в новой версии?"
          className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex items-stretch gap-2">
          <button
            onClick={makeVersion}
            disabled={pending || !note.trim()}
            className="min-h-[46px] flex-1 rounded-md bg-violet-500 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {pending ? "Claude думает…" : `Создать v${(latest?.version ?? 0) + 1}`}
          </button>
          <button
            onClick={saveAsIs}
            disabled={pending || text === selected?.text}
            className="min-h-[46px] rounded-md border border-[var(--border-default)] px-3 text-[10.5px] font-semibold leading-tight text-t200 hover:bg-ink-500 hover:text-t100 disabled:opacity-50"
          >
            Сохранить
            <br />
            как есть
          </button>
        </div>
      </div>
    </div>
  );
}
