"use client";

/**
 * Шоты группы: единственный источник текста группы (Story fragment убран —
 * он дублировал эти же данные). Поля правятся вручную (сохранение по кнопке),
 * а замечание к группе целиком уходит в Claude и возвращает её переработанной.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGroupBeats, reviseGroup } from "@/lib/actions/shots";
import type { GroupShot } from "@/lib/llm/contracts";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

const inputCls =
  "w-full rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-[var(--border-strong)] focus:bg-ink-800";

export default function GroupShotsEditor({
  shotId,
  initialBeats,
}: {
  shotId: string;
  initialBeats: GroupShot[];
}) {
  const router = useRouter();
  const t = useT();
  const [beats, setBeats] = useState<GroupShot[]>(initialBeats);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [saving, startSave] = useTransition();

  // после reviseGroup сервер отдаёт новые шоты — принимаем их, если нет своих
  // правок (подстройка состояния при смене пропа, без эффекта)
  const [prevInitial, setPrevInitial] = useState(initialBeats);
  if (prevInitial !== initialBeats) {
    setPrevInitial(initialBeats);
    if (!dirty) setBeats(initialBeats);
  }

  useEffect(() => {
    if (!revising) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [revising]);

  function patch(i: number, p: Partial<GroupShot>) {
    setBeats(beats.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
    setDirty(true);
  }

  function save() {
    startSave(async () => {
      await updateGroupBeats(shotId, beats);
      setDirty(false);
      toast(t("Шоты сохранены", "Shots saved"));
      router.refresh();
    });
  }

  async function onRevise() {
    setElapsed(0);
    setRevising(true);
    setError("");
    const res = await reviseGroup(shotId, feedback);
    setRevising(false);
    if (res.ok) {
      setFeedback("");
      setDirty(false);
      toast(t("Группа переработана", "Group reworked"));
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {beats.map((b, i) => (
        <div key={i} className="rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-2.5">
          <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-t400">
            {t("Шот", "Shot")} {b.order}
            {b.time ? ` · ${b.time}` : ""}
          </div>
          <div className="mb-1 flex flex-col gap-0.5 font-mono text-[10px] leading-relaxed text-t400 sm:flex-row sm:gap-2">
            <input
              value={b.framing}
              onChange={(e) => patch(i, { framing: e.target.value })}
              placeholder={t("План и ракурс", "Framing & angle")}
              className={`${inputCls} sm:flex-1`}
            />
            <input
              value={b.camera}
              onChange={(e) => patch(i, { camera: e.target.value })}
              placeholder={t("Что видит камера", "What the camera sees")}
              className={`${inputCls} sm:flex-1`}
            />
          </div>
          <textarea
            value={b.action}
            onChange={(e) => patch(i, { action: e.target.value })}
            rows={2}
            placeholder={t("Действие и эмоция", "Action & emotion")}
            className={`${inputCls} resize-y text-[12px] leading-relaxed text-t200`}
          />
          <input
            value={b.dialogue}
            onChange={(e) => patch(i, { dialogue: e.target.value })}
            placeholder={t("Реплика (если есть)", "Dialogue (if any)")}
            className={`${inputCls} text-[12px] text-violet-200 placeholder:text-t400`}
          />
        </div>
      ))}

      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="min-h-11 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-60"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {saving ? t("Сохранение…", "Saving…") : t("Сохранить шоты", "Save shots")}
        </button>
      )}

      <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-[var(--border-default)] p-2.5">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder={t(
            "Замечание к группе: что переделать (темп, планы, реплики, эмоции)…",
            "Feedback for the group: what to rework (pace, framing, dialogue, emotion)…",
          )}
          className="w-full resize-y rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        {error && <div className="text-[11px] text-danger">{error}</div>}
        <button
          onClick={onRevise}
          disabled={revising || !feedback.trim()}
          className="min-h-11 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:bg-ink-500 disabled:opacity-50"
        >
          {revising
            ? t(`Claude переделывает… ${elapsed}с`, `Claude is reworking… ${elapsed}s`)
            : t("Переделать по замечанию (Claude)", "Rework per feedback (Claude)")}
        </button>
      </div>
    </div>
  );
}
