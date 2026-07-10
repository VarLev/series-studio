"use client";

/**
 * Экран «Ревью и A/B» (spec §2.5, §4): нейтрально-серая зона, свайп/точки
 * кандидатов, режим «Сравнить» (слайдер 50/50 на мобиле, два плеера на десктопе),
 * транспорт c тайм-кодом 00:SS:FF и покадровыми шагами, «Взять кадр» →
 * референсы серии / start-frame следующего шота, «Замечание» → vN+1 → перегенерация,
 * «Победитель». Hotkeys: Space, ←/→, Enter, Esc.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { toast } from "@/components/Toaster";
import { setWinner } from "@/lib/actions/generations";
import { revisePrompt } from "@/lib/actions/prompts";
import { startGeneration } from "@/lib/actions/generate";

const FPS = 24;
const FRAME = 1 / FPS;

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

function timecode(t: number): string {
  const ss = Math.floor(t);
  const ff = Math.floor((t - ss) * FPS);
  return `00:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}

export default function ReviewPlayer({
  episodeId,
  shotId,
  shotLabel,
  shotTitle,
  shotStatus,
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
  shotStatus: string;
  candidates: Candidate[];
  initialId: string | null;
  entities: Array<{ id: string; name: string }>;
  nextShot: { id: string; label: string } | null;
  latestPromptId: string | null;
  latestVersion: number;
  regenParams: { durationSec: number; aspectRatio: string; quality: string };
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(() => {
    const found = candidates.findIndex((c) => c.id === initialId);
    return found >= 0 ? found : 0;
  });
  const current = candidates[idx] ?? null;
  const other = candidates.length > 1 ? candidates[(idx + 1) % candidates.length] : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(50); // позиция разделителя, %
  const [grabOpen, setGrabOpen] = useState(false);
  const [grabDataUrl, setGrabDataUrl] = useState<string | null>(null);
  const [grabTime, setGrabTime] = useState(0);
  const [grabTarget, setGrabTarget] = useState<string>(""); // "series" | "next-shot" | entityId
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const touchStart = useRef<number | null>(null);
  const dragging = useRef(false);

  const shotHref = `/episodes/${episodeId}/shots/${shotId}`;

  // сброс плеера при смене кандидата — корректировка состояния во время рендера
  const [prevIdx, setPrevIdx] = useState(idx);
  if (idx !== prevIdx) {
    setPrevIdx(idx);
    setPlaying(false);
    setTime(0);
  }

  const eachVideo = useCallback((fn: (v: HTMLVideoElement) => void) => {
    if (videoRef.current) fn(videoRef.current);
    if (videoBRef.current) fn(videoBRef.current);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      eachVideo((x) => void x.play().catch(() => {}));
      setPlaying(true);
    } else {
      eachVideo((x) => x.pause());
      setPlaying(false);
    }
  }, [eachVideo]);

  const step = useCallback(
    (dir: 1 | -1) => {
      eachVideo((x) => {
        x.pause();
        x.currentTime = Math.min(Math.max(0, x.currentTime + dir * FRAME), x.duration || 0);
      });
      setPlaying(false);
    },
    [eachVideo],
  );

  const switchCandidate = useCallback(
    (dir: 1 | -1) => {
      if (candidates.length < 2) return;
      setIdx((prev) => (prev + dir + candidates.length) % candidates.length);
    },
    [candidates.length],
  );

  const pickWinner = useCallback(() => {
    if (!current || current.isWinner) return;
    startTransition(async () => {
      await setWinner(shotId, current.id);
      toast(`★ Победитель: ${current.model} — шот утверждён`);
      router.refresh();
    });
  }, [current, router, shotId]);

  // hotkeys (spec §5, e.code — независимо от раскладки)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (grabOpen || noteOpen) {
        if (e.code === "Escape") {
          setGrabOpen(false);
          setNoteOpen(false);
        }
        return;
      }
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          step(-1);
          break;
        case "ArrowRight":
          step(1);
          break;
        case "Enter":
          pickWinner();
          break;
        case "Escape":
          router.push(shotHref);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [grabOpen, noteOpen, togglePlay, step, pickWinner, router, shotHref]);

  function grabFrame() {
    const v = videoRef.current;
    if (!v) return;
    eachVideo((x) => x.pause());
    setPlaying(false);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const g = canvas.getContext("2d");
    if (!g) return;
    try {
      g.drawImage(v, 0, 0);
      setGrabDataUrl(canvas.toDataURL("image/jpeg", 0.92));
      setGrabTime(v.currentTime);
      setGrabTarget("series");
      setGrabOpen(true);
    } catch {
      toast("Не удалось захватить кадр (CORS источника видео)");
    }
  }

  async function saveFrame() {
    if (!grabDataUrl || !grabTarget) return;
    const blob = await (await fetch(grabDataUrl)).blob();
    const form = new FormData();
    form.set("file", new File([blob], "frame.jpg", { type: "image/jpeg" }));
    form.set("kind", "reference");
    form.set("source", "frame-grab");
    form.set("caption", `кадр ${timecode(grabTime)} · ${shotLabel}`);
    if (grabTarget === "series") {
      form.set("episodeId", episodeId);
    } else if (grabTarget === "next-shot" && nextShot) {
      form.set("shotId", nextShot.id);
      form.set("role", "start_frame");
    } else {
      form.set("entityId", grabTarget);
    }
    const res = await fetch("/api/upload", { method: "POST", body: form });
    if (res.ok) {
      setGrabOpen(false);
      toast(
        grabTarget === "series"
          ? "Кадр сохранён в референсы серии"
          : grabTarget === "next-shot"
            ? `Кадр — start-frame шота (${nextShot?.label})`
            : "Кадр сохранён в библию",
      );
      router.refresh();
    } else {
      toast("Ошибка сохранения кадра");
    }
  }

  function submitNote(regen: boolean) {
    if (!note.trim() || !latestPromptId) return;
    startTransition(async () => {
      const res = await revisePrompt(latestPromptId, note.trim());
      if (!res.ok) {
        toast(res.error);
        return;
      }
      if (regen && current) {
        await startGeneration({
          shotId,
          promptId: res.promptId,
          modelIds: [current.model],
          durationSec: regenParams.durationSec,
          aspectRatio: regenParams.aspectRatio,
          quality: regenParams.quality,
          confirmed: true,
        });
        toast(`v${latestVersion + 1} создана · перегенерация запущена`);
      } else {
        toast(`v${latestVersion + 1} создана`);
      }
      setNoteOpen(false);
      setNote("");
      router.push(shotHref);
    });
  }

  // перетаскивание разделителя «Сравнить»
  function onSplitPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(92, Math.max(8, ((e.clientX - rect.left) / rect.width) * 100)));
  }

  if (!current) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#050505] p-6 text-center">
        <div className="text-[13px] text-[#8a8a8a]">Готовых результатов пока нет.</div>
        <Link href={shotHref} className="text-[12px] font-semibold text-[#bdbdbd] underline">
          ← Вернуться к шоту
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-lg flex-col bg-[#050505] lg:max-w-none">
      {/* шапка — нейтрально-серая */}
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
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.24em] text-[#6f6f6f]">
            Ревью · {shotLabel} · {idx + 1} из {candidates.length}
          </div>
          <div className="truncate text-[13px] font-semibold text-[#e6e6e6]">{shotTitle}</div>
        </div>
        <span className="rounded border border-[#2a2a2a] bg-[#141414] px-2 py-1 font-mono text-[9.5px] text-[#bdbdbd]">
          {current.model}
          {current.promptVersion != null ? ` · v${current.promptVersion}` : ""}
          {current.credits != null ? ` · ${current.credits} кр` : ""}
        </span>
        {shotStatus === "approved" && (
          <span className="rounded bg-success px-1.5 py-1 text-[9px] font-semibold text-ink-900">
            Утверждён
          </span>
        )}
        {candidates.length > 1 && (
          <button
            onClick={() => setCompare((v) => !v)}
            className="min-h-8 rounded-md border px-2.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
            style={{
              borderColor: compare ? "#e6e6e6" : "#2a2a2a",
              color: compare ? "#e6e6e6" : "#8a8a8a",
              background: compare ? "#1c1c1c" : "none",
            }}
          >
            Сравнить
          </button>
        )}
      </div>

      {/* видео: одиночный / сравнение */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onWheel={(e) => {
          if (compare) return;
          if (Math.abs(e.deltaY) > 24) switchCandidate(e.deltaY > 0 ? 1 : -1);
        }}
        onTouchStart={(e) => (touchStart.current = e.touches[0].clientY)}
        onTouchEnd={(e) => {
          if (compare || touchStart.current == null) return;
          const delta = e.changedTouches[0].clientY - touchStart.current;
          if (Math.abs(delta) > 60) switchCandidate(delta < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        {!compare || !other ? (
          current.isVideo ? (
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
          )
        ) : (
          <>
            {/* мобильное сравнение: слайдер 50/50 */}
            <div
              className="relative h-full w-full lg:hidden"
              onPointerDown={(e) => {
                dragging.current = true;
                onSplitPointer(e);
              }}
              onPointerMove={onSplitPointer}
              onPointerUp={() => (dragging.current = false)}
            >
              <video
                key={`a-${current.id}`}
                ref={videoRef}
                src={current.url}
                crossOrigin="anonymous"
                playsInline
                muted
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                className="absolute inset-0 h-full w-full object-contain"
              />
              <video
                key={`b-${other.id}`}
                ref={videoBRef}
                src={other.url}
                crossOrigin="anonymous"
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-contain"
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              />
              <div
                className="absolute inset-y-0 z-10 w-0.5 bg-[#e6e6e6]"
                style={{ left: `${split}%` }}
              >
                <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#e6e6e6] bg-[#0b0b0bcc] text-[10px] text-[#e6e6e6]">
                  ⇄
                </span>
              </div>
              <span className="absolute left-2 top-2 rounded bg-[#0b0b0bcc] px-1.5 py-1 font-mono text-[9px] text-[#e6e6e6]">
                A · {current.model}
              </span>
              <span className="absolute right-2 top-2 rounded bg-[#0b0b0bcc] px-1.5 py-1 font-mono text-[9px] text-[#e6e6e6]">
                B · {other.model}
              </span>
            </div>
            {/* десктопное сравнение: два синхронных плеера (spec §4) */}
            <div className="hidden h-full w-full grid-cols-2 gap-1 lg:grid">
              {[current, other].map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => i === 1 && setIdx((idx + 1) % candidates.length)}
                  className="relative flex items-center justify-center overflow-hidden"
                  style={{
                    outline: c.isWinner ? "2px solid var(--success)" : "1px solid #1b1b1b",
                  }}
                >
                  <video
                    key={c.id}
                    ref={i === 0 ? videoRef : videoBRef}
                    src={c.url}
                    crossOrigin="anonymous"
                    playsInline
                    muted={i === 1}
                    onTimeUpdate={i === 0 ? (e) => setTime(e.currentTarget.currentTime) : undefined}
                    onLoadedMetadata={
                      i === 0 ? (e) => setDuration(e.currentTarget.duration) : undefined
                    }
                    className="max-h-full w-full object-contain"
                  />
                  <span className="absolute left-2 top-2 rounded bg-[#0b0b0bcc] px-1.5 py-1 font-mono text-[9px] text-[#e6e6e6]">
                    {i === 0 ? "A" : "B"} · {c.model}
                    {c.promptVersion != null ? ` · v${c.promptVersion}` : ""}
                  </span>
                  {c.isWinner && (
                    <span className="absolute right-2 top-2 rounded bg-success px-1.5 py-0.5 text-[9px] font-semibold text-ink-900">
                      ★ ПОБЕДИТЕЛЬ
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* точки-индикаторы кандидатов (spec §2.5) */}
        {candidates.length > 1 && !compare && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
            {candidates.map((c, i) => (
              <button
                key={c.id}
                aria-label={`Кандидат ${i + 1}`}
                onClick={() => setIdx(i)}
                className="h-2 w-2 rounded-full"
                style={{ background: i === idx ? "#e6e6e6" : "#3a3a3a" }}
              />
            ))}
          </div>
        )}
      </div>

      {/* транспорт */}
      {current.isVideo && (
        <div className="flex items-center gap-1.5 border-t border-[#1b1b1b] bg-[#0b0b0b] px-3 py-2">
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
            className="flex h-11 w-11 items-center justify-center rounded-md font-mono text-[16px] text-[#e6e6e6] hover:bg-[#181818]"
          >
            ‹
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Кадр вперёд"
            className="flex h-11 w-11 items-center justify-center rounded-md font-mono text-[16px] text-[#e6e6e6] hover:bg-[#181818]"
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
              const t = Number(e.target.value);
              eachVideo((x) => (x.currentTime = t));
              setTime(t);
            }}
            className="min-w-0 flex-1 accent-[#e6e6e6]"
          />
          <span className="font-mono text-[10px] text-[#8a8a8a]">
            {timecode(time)} · {duration ? `${duration.toFixed(0)}с` : "—"}
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
          disabled={pending}
          className="flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-lg bg-success text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-900 disabled:opacity-70"
        >
          <span>★</span>
          {current.isWinner ? "Утверждён" : "Победитель"}
        </button>
      </div>

      {/* Шторка «Взять кадр» (spec §2.5/§3.5) */}
      <Sheet open={grabOpen} onClose={() => setGrabOpen(false)} title={`Кадр ${timecode(grabTime)} — сохранить как…`}>
        {grabDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={grabDataUrl}
            alt="Кадр"
            className="mb-3 w-full rounded-lg border border-[var(--border-subtle)]"
          />
        )}
        <div className="flex flex-col gap-1.5">
          <label
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3"
            style={{
              borderColor: grabTarget === "series" ? "var(--violet-400)" : "var(--border-subtle)",
              background: grabTarget === "series" ? "rgba(139,95,176,.1)" : "none",
            }}
          >
            <input
              type="radio"
              name="grab-target"
              checked={grabTarget === "series"}
              onChange={() => setGrabTarget("series")}
              className="accent-[var(--violet-400)]"
            />
            <span className="text-[12.5px] font-medium text-t100">
              В референсы серии (получит токен REF_NN)
            </span>
          </label>
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
                Start-frame шота {nextShot.label} (image-to-video продолжит кадр)
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

      {/* Шторка «Замечание» (spec §2.5) */}
      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title="Замечание к результату">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Что не так? Промпт-фабрика создаст версию с учётом замечания."
          className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <div className="mt-3.5 flex flex-col gap-2">
          <button
            onClick={() => submitNote(true)}
            disabled={pending || !note.trim()}
            className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {pending ? "Claude думает…" : `Создать v${latestVersion + 1} и перегенерировать`}
          </button>
          <button
            onClick={() => submitNote(false)}
            disabled={pending || !note.trim()}
            className="min-h-11 w-full rounded-lg border border-[var(--border-default)] text-[10.5px] font-semibold uppercase tracking-[0.1em] text-t200 hover:bg-ink-500 disabled:opacity-50"
          >
            Только создать версию
          </button>
        </div>
      </Sheet>
    </main>
  );
}
