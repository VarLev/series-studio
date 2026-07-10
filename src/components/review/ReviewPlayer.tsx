"use client";

/**
 * Экран «Ревью и A/B» (UI TZ §4.5, M5): тёмный плеер, покадровая перемотка ±1,
 * «Взять кадр» (canvas → референс сущности / start-frame следующего шота),
 * «Замечание» → версия N+1 → перегенерация, «Победитель».
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { setWinner } from "@/lib/actions/generations";
import { updateShot } from "@/lib/actions/shots";
import { revisePrompt } from "@/lib/actions/prompts";
import { startGeneration } from "@/lib/actions/generate";

const FRAME = 1 / 24;

export interface Candidate {
  id: string;
  model: string;
  url: string;
  isVideo: boolean;
  isWinner: boolean;
  promptVersion: number | null;
  credits: number | null;
  source: string;
}

export default function ReviewPlayer({
  episodeId,
  shotId,
  shotLabel,
  shotTitle,
  candidates,
  initialId,
  entities,
  nextShot,
  latestPromptId,
  latestVersion,
  regenParams,
}: {
  episodeId: string;
  shotId: string;
  shotLabel: string;
  shotTitle: string;
  candidates: Candidate[];
  initialId: string | null;
  entities: Array<{ id: string; name: string }>;
  nextShot: { id: string; label: string } | null;
  latestPromptId: string | null;
  latestVersion: number;
  regenParams: { durationSec: number; aspectRatio: string };
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(() => {
    const found = candidates.findIndex((c) => c.id === initialId);
    return found >= 0 ? found : 0;
  });
  const current = candidates[idx] ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [grabOpen, setGrabOpen] = useState(false);
  const [grabDataUrl, setGrabDataUrl] = useState<string | null>(null);
  const [grabTarget, setGrabTarget] = useState<string>(""); // entityId | "next-shot"
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [regen, setRegen] = useState(true);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const shotHref = `/episodes/${episodeId}/shots/${shotId}`;

  // сброс состояния плеера при переключении A/B-кандидата — паттерн React
  // «корректировка состояния во время рендера», без эффекта
  const [prevIdx, setPrevIdx] = useState(idx);
  if (idx !== prevIdx) {
    setPrevIdx(idx);
    setPlaying(false);
    setTime(0);
  }

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  function step(dir: 1 | -1) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
    v.currentTime = Math.min(Math.max(0, v.currentTime + dir * FRAME), v.duration || 0);
  }

  // hotkeys (UI TZ §3): пробел — play, ←/→ — покадрово, Enter — победитель
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (grabOpen || noteOpen) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [grabOpen, noteOpen, togglePlay]);

  function grabFrame() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const g = canvas.getContext("2d");
    if (!g) return;
    try {
      g.drawImage(v, 0, 0);
      setGrabDataUrl(canvas.toDataURL("image/jpeg", 0.92));
      setGrabTarget("");
      setGrabOpen(true);
    } catch {
      setMessage("Не удалось захватить кадр (CORS источника видео)");
    }
  }

  async function saveFrame() {
    if (!grabDataUrl || !grabTarget) return;
    const blob = await (await fetch(grabDataUrl)).blob();
    const form = new FormData();
    form.set("file", new File([blob], "frame.jpg", { type: "image/jpeg" }));
    form.set("kind", "reference");
    form.set("source", "frame-grab");
    form.set("caption", `кадр из ${shotLabel}`);
    if (grabTarget === "next-shot" && nextShot) {
      form.set("shotId", nextShot.id);
      form.set("role", "start_frame");
    } else {
      form.set("entityId", grabTarget);
    }
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (res.ok) {
      setGrabOpen(false);
      setMessage(
        grabTarget === "next-shot"
          ? `Кадр сохранён как start-frame (${nextShot?.label})`
          : "Кадр сохранён в библию",
      );
      router.refresh();
    } else {
      setMessage("Ошибка сохранения кадра");
    }
  }

  function submitNote() {
    if (!note.trim() || !latestPromptId) return;
    startTransition(async () => {
      const res = await revisePrompt(latestPromptId, note.trim());
      if (!res.ok) {
        setMessage(res.error);
        return;
      }
      if (regen && current) {
        await startGeneration({
          shotId,
          promptId: res.promptId,
          modelIds: [current.model],
          durationSec: regenParams.durationSec,
          aspectRatio: regenParams.aspectRatio,
          confirmed: true,
        });
      }
      setNoteOpen(false);
      setNote("");
      router.push(shotHref);
    });
  }

  function pickWinner() {
    if (!current) return;
    startTransition(async () => {
      await setWinner(shotId, current.id);
      await updateShot(shotId, { status: "approved" });
      router.refresh();
      setMessage("Победитель выбран — шот утверждён");
    });
  }

  if (!current) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#050505] p-6 text-center">
        <div className="text-[13px] text-t300">Готовых результатов пока нет.</div>
        <Link href={shotHref} className="text-[12px] font-semibold text-violet-200 underline">
          ← Вернуться к шоту
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-lg flex-col bg-[#050505] md:max-w-4xl">
      {/* шапка */}
      <div
        className="flex items-center gap-2 border-b border-[#1b1b1b] bg-[#0b0b0b] px-2.5 py-2"
        style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}
      >
        <Link
          href={shotHref}
          aria-label="Назад"
          className="flex h-10 w-10 items-center justify-center rounded-md text-[#e6e6e6] hover:bg-[#181818]"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-t400">
            Ревью · {shotLabel}
          </div>
          <div className="truncate text-[13px] font-semibold text-[#e6e6e6]">{shotTitle}</div>
        </div>
        <span className="font-mono text-[10px] text-t400">
          {idx + 1}/{candidates.length}
        </span>
      </div>

      {/* кандидаты A/B */}
      {candidates.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-[#1b1b1b] bg-[#0b0b0b] px-2.5 py-2">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setIdx(i)}
              className="flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10.5px] font-semibold"
              style={{
                borderColor: i === idx ? "var(--violet-400)" : "#242424",
                color: i === idx ? "var(--violet-100)" : "var(--text-400)",
                background: i === idx ? "rgba(139,95,176,.12)" : "none",
              }}
            >
              {c.model}
              {c.promptVersion != null && <span className="text-magenta-400">v{c.promptVersion}</span>}
              {c.isWinner && <span className="text-success">★</span>}
            </button>
          ))}
        </div>
      )}

      {/* видео максимально крупно, вокруг почти чёрное поле */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {current.isVideo ? (
          <video
            key={current.id}
            ref={videoRef}
            src={current.url}
            crossOrigin="anonymous"
            playsInline
            onClick={togglePlay}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onEnded={() => setPlaying(false)}
            className="max-h-full w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt="" className="max-h-full w-full object-contain" />
        )}
      </div>

      {message && (
        <div className="border-t border-[#1b1b1b] bg-[#0b0b0b] px-3 py-2 text-[11px] text-success">
          {message}
        </div>
      )}

      {/* управление */}
      {current.isVideo && (
        <div className="flex items-center gap-2 border-t border-[#1b1b1b] bg-[#0b0b0b] px-3 py-2">
          <button
            onClick={togglePlay}
            aria-label={playing ? "Пауза" : "Играть"}
            className="flex h-11 w-11 items-center justify-center rounded-md text-[16px] text-[#e6e6e6] hover:bg-[#181818]"
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => step(-1)}
            aria-label="Кадр назад"
            className="flex h-11 w-11 items-center justify-center rounded-md font-mono text-[14px] text-[#e6e6e6] hover:bg-[#181818]"
          >
            ‹
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Кадр вперёд"
            className="flex h-11 w-11 items-center justify-center rounded-md font-mono text-[14px] text-[#e6e6e6] hover:bg-[#181818]"
          >
            ›
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={FRAME}
            value={time}
            onChange={(e) => {
              const v = videoRef.current;
              if (v) v.currentTime = Number(e.target.value);
            }}
            className="min-w-0 flex-1 accent-[var(--violet-400)]"
          />
          <span className="font-mono text-[10px] text-t400">
            {time.toFixed(1)}/{(duration || 0).toFixed(1)}s
          </span>
        </div>
      )}

      {/* нижняя панель: [Замечание] [Взять кадр] [Победитель] */}
      <div
        className="flex gap-2 border-t border-[#1b1b1b] bg-[#0b0b0b] px-3 py-2.5"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={() => setNoteOpen(true)}
          disabled={!latestPromptId}
          className="flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-[#2a2a2a] bg-[#141414] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#e6e6e6] hover:bg-[#1c1c1c] disabled:opacity-40"
        >
          <span>👎</span>Замечание
        </button>
        <button
          onClick={grabFrame}
          disabled={!current.isVideo}
          className="flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-[#2a2a2a] bg-[#141414] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#e6e6e6] hover:bg-[#1c1c1c] disabled:opacity-40"
        >
          <span>📷</span>Взять кадр
        </button>
        <button
          onClick={pickWinner}
          disabled={pending || current.isWinner}
          className="flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-900 disabled:opacity-60"
          style={{ background: current.isWinner ? "var(--success)" : "var(--success)" }}
        >
          <span>★</span>
          {current.isWinner ? "Победитель" : "Победитель"}
        </button>
      </div>

      {/* Шторка «Взять кадр» */}
      <Sheet open={grabOpen} onClose={() => setGrabOpen(false)} title="Сохранить кадр как…">
        {grabDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={grabDataUrl}
            alt="Кадр"
            className="mb-3 w-full rounded-lg border border-[var(--border-subtle)]"
          />
        )}
        <div className="flex flex-col gap-1.5">
          {nextShot && (
            <label
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3"
              style={{
                borderColor: grabTarget === "next-shot" ? "var(--warning)" : "var(--border-subtle)",
                background: grabTarget === "next-shot" ? "rgba(192,138,62,.08)" : "none",
              }}
            >
              <input
                type="radio"
                name="grab-target"
                checked={grabTarget === "next-shot"}
                onChange={() => setGrabTarget("next-shot")}
                className="accent-[var(--warning)]"
              />
              <span className="text-[12.5px] font-medium text-t100">
                Start-frame следующего шота ({nextShot.label})
              </span>
            </label>
          )}
          <div className="section-label mt-2">Референс к сущности</div>
          {entities.map((e) => (
            <label
              key={e.id}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3"
              style={{
                borderColor: grabTarget === e.id ? "var(--border-strong)" : "var(--border-subtle)",
                background: grabTarget === e.id ? "var(--ink-600)" : "none",
              }}
            >
              <input
                type="radio"
                name="grab-target"
                checked={grabTarget === e.id}
                onChange={() => setGrabTarget(e.id)}
                className="accent-[var(--violet-400)]"
              />
              <span className="text-[12.5px] text-t200">{e.name}</span>
            </label>
          ))}
        </div>
        <button
          onClick={saveFrame}
          disabled={!grabTarget}
          className="mt-4 min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          Сохранить кадр
        </button>
      </Sheet>

      {/* Шторка «Замечание» */}
      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Замечание к результату">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Что не так? Промпт-фабрика создаст версию с учётом замечания."
          className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <label className="mt-2.5 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={regen}
            onChange={(e) => setRegen(e.target.checked)}
            className="h-5 w-5 accent-[var(--violet-400)]"
          />
          <span className="text-[12px] text-t200">
            Сразу перегенерировать ({current.model})
          </span>
        </label>
        <button
          onClick={submitNote}
          disabled={pending || !note.trim()}
          className="mt-3.5 min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {pending ? "Claude думает…" : `Создать v${latestVersion + 1}${regen ? " и запустить" : ""}`}
        </button>
      </Sheet>
    </main>
  );
}
