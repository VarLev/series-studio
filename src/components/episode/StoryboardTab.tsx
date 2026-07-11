"use client";

/**
 * Вкладка «Раскадровка»: листы Nano Banana 9:16 с сеткой 2×2 / 3×3 вертикальных
 * кадров — на всю серию или на конкретный шот. Лист можно разрезать на отдельные
 * кадры; каждый элемент — апскейл / правка / удаление (только вручную).
 * Всё созданное автоматически становится референсами серии (REF_NN).
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { generateStoryboard, sliceStoryboard } from "@/lib/actions/storyboard";
import { upscaleReference, editReference } from "@/lib/actions/generate";
import { deleteReference } from "@/lib/actions/entities";
import { SectionLabel, EmptyState } from "@/components/ui";
import type { ShotListItem } from "./ShotsList";

export interface StoryboardItem {
  id: string;
  url: string;
  token: string | null;
  caption: string;
}

export interface StoryboardSheetData extends StoryboardItem {
  grid: number; // 4 | 9
  sbShotId: string | null;
  frames: StoryboardItem[];
}

export interface StoryboardData {
  sheets: StoryboardSheetData[];
  orphanFrames: StoryboardItem[]; // кадры, чей лист уже удалён
  attachRefs: Array<{ id: string; url: string; label: string }>;
  pendingCount: number;
}

const FRAME_OPTIONS = [4, 9] as const;
const RESOLUTIONS = [
  { id: "1k", label: "1K", credits: 4 },
  { id: "2k", label: "2K", credits: 6 },
  { id: "4k", label: "4K", credits: 10 },
] as const;

function trimText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Равномерная выборка n элементов из списка (если шотов больше, чем кадров). */
function evenPick<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  }
  return [...new Set(out)];
}

function buildPrompt(scope: ShotListItem | null, frames: number, shots: ShotListItem[]): string {
  const gridTxt = frames === 9 ? "3x3 grid of 9" : "2x2 grid of 4";
  const head =
    `Cinematic storyboard contact sheet: a ${gridTxt} vertical 9:16 panels arranged on a single vertical 9:16 canvas, thin black gutters between panels. ` +
    `Live-action photorealistic film stills. Consistent characters, wardrobe, lighting and color grading across all panels. No text, no numbers, no watermarks.`;
  if (scope) {
    return (
      `${head}\n\nScene (${scope.durationSec}s): ${scope.title ? scope.title + ". " : ""}${trimText(scope.action, 400)}\n` +
      `The ${frames} panels show the progression of this single scene moment by moment, with varied cinematic camera angles (wide, medium, close-up).`
    );
  }
  const picked = evenPick(shots, frames);
  if (!picked.length) {
    return `${head}\n\nStory beats: describe the episode here — one beat per panel.`;
  }
  const lines = picked.map(
    (s, i) => `${i + 1}. ${s.title ? s.title + " — " : ""}${trimText(s.action, 160)}`,
  );
  const tail =
    picked.length < frames
      ? `\nDistribute these beats across all ${frames} panels, expanding key moments into additional angles.`
      : "";
  return `${head}\n\nStory beats in order, one per panel:\n${lines.join("\n")}${tail}`;
}

export default function StoryboardTab({
  episodeId,
  shots,
  data,
}: {
  episodeId: string;
  shots: ShotListItem[];
  data: StoryboardData;
}) {
  const router = useRouter();
  const [scopeId, setScopeId] = useState<string>(""); // "" = вся серия
  const [frames, setFrames] = useState<(typeof FRAME_OPTIONS)[number]>(9);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]["id"]>("2k");
  const [promptEdited, setPromptEdited] = useState<string | null>(null);
  const [attach, setAttach] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [slicing, setSlicing] = useState<string | null>(null);

  // детальный просмотр кадра/листа + правка
  const [detail, setDetail] = useState<StoryboardItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");

  const scope = useMemo(() => shots.find((s) => s.id === scopeId) ?? null, [shots, scopeId]);
  const autoPrompt = useMemo(() => buildPrompt(scope, frames, shots), [scope, frames, shots]);
  const prompt = promptEdited ?? autoPrompt;
  const credits = RESOLUTIONS.find((r) => r.id === resolution)?.credits ?? 6;

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await generateStoryboard({
        episodeId,
        shotId: scopeId || null,
        frames,
        resolution,
        prompt,
        refIds: attach,
      });
      if (res.ok) {
        toast(`Раскадровка поставлена · ${credits} кр — лист появится здесь и в референсах`);
        router.refresh();
      } else setError(res.error);
    });
  }

  function doSlice(sheet: StoryboardSheetData) {
    setSlicing(sheet.id);
    startTransition(async () => {
      const res = await sliceStoryboard(sheet.id);
      setSlicing(null);
      if (res.ok) {
        toast(`Лист разрезан на ${res.created} кадров — все получили REF-токены`);
        router.refresh();
      } else toast(res.error);
    });
  }

  function doUpscale(item: StoryboardItem) {
    startTransition(async () => {
      const res = await upscaleReference(item.id);
      toast(res.ok ? "Upscale ×2 поставлен · 4 кр" : ("error" in res && res.error) || "Ошибка");
      if (res.ok) {
        setDetail(null);
        router.refresh();
      }
    });
  }

  function doEdit(item: StoryboardItem) {
    if (!editPrompt.trim()) return;
    startTransition(async () => {
      const res = await editReference({ refId: item.id, prompt: editPrompt.trim(), extraRefIds: [] });
      toast(res.ok ? "Правка поставлена · ≈6 кр · исходник не тронут" : ("error" in res && res.error) || "Ошибка");
      if (res.ok) {
        setEditOpen(false);
        setDetail(null);
        setEditPrompt("");
        router.refresh();
      }
    });
  }

  const scopeLabel = (sbShotId: string | null) => {
    if (!sbShotId) return "вся серия";
    const s = shots.find((x) => x.id === sbShotId);
    return s ? `группа ${String(s.orderIndex).padStart(2, "0")}` : "шот удалён";
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-10">
      {/* ---------- Генератор листа ---------- */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
        <div className="text-[11px] leading-relaxed text-t400">
          <span className="text-violet-600">✦</span>&nbsp; Nano Banana рисует вертикальный лист 9:16
          с сеткой вертикальных кадров. Готовый лист можно разрезать на отдельные кадры — всё
          автоматически попадает в референсы серии.
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="section-label">Область</span>
            <select
              value={scopeId}
              onChange={(e) => {
                setScopeId(e.target.value);
                setPromptEdited(null); // новая область — пересобрать промпт
              }}
              className="min-h-10 w-full rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
            >
              <option value="">Вся серия</option>
              {shots.map((s) => (
                <option key={s.id} value={s.id}>
                  {String(s.orderIndex).padStart(2, "0")} · {trimText(s.title || s.action, 40)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="section-label">Кадров</span>
            <div className="flex gap-1.5">
              {FRAME_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setFrames(n);
                    setPromptEdited(null);
                  }}
                  className="flex min-h-10 min-w-[64px] flex-col items-center justify-center rounded-md border"
                  style={{
                    borderColor: frames === n ? "var(--border-strong)" : "var(--border-subtle)",
                    background: frames === n ? "var(--ink-600)" : "none",
                  }}
                >
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: frames === n ? "var(--text-100)" : "var(--text-400)" }}
                  >
                    {n}
                  </span>
                  <span className="font-mono text-[8.5px] text-t400">{n === 9 ? "3×3" : "2×2"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="section-label">Размер</span>
            <div className="flex gap-1.5">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setResolution(r.id)}
                  className="flex min-h-10 min-w-[52px] flex-col items-center justify-center rounded-md border"
                  style={{
                    borderColor: resolution === r.id ? "var(--border-strong)" : "var(--border-subtle)",
                    background: resolution === r.id ? "var(--ink-600)" : "none",
                  }}
                >
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: resolution === r.id ? "var(--text-100)" : "var(--text-400)" }}
                  >
                    {r.label}
                  </span>
                  <span className="font-mono text-[8.5px] text-t400">{r.credits} кр</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <SectionLabel
            right={
              promptEdited !== null ? (
                <button
                  onClick={() => setPromptEdited(null)}
                  className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-t400 hover:text-violet-200"
                >
                  ↻ пересобрать из шотов
                </button>
              ) : (
                <span className="font-mono text-[9px] text-t400">собран из шотов · правится</span>
              )
            }
          >
            Промпт листа
          </SectionLabel>
          <textarea
            value={prompt}
            onChange={(e) => setPromptEdited(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
          />
        </div>

        {data.attachRefs.length > 0 && (
          <div className="flex flex-col gap-1">
            <SectionLabel hint="персонажи/стиль для консистентности">Приложить референсы</SectionLabel>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {data.attachRefs.map((r) => {
                const on = attach.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      setAttach((prev) => (on ? prev.filter((x) => x !== r.id) : [...prev, r.id]))
                    }
                    className="w-[48px] shrink-0"
                  >
                    <span
                      className="block aspect-[9/16] overflow-hidden rounded-md border-2"
                      style={{ borderColor: on ? "var(--violet-400)" : "var(--border-subtle)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="h-full w-full object-cover" />
                    </span>
                    <span className="mt-0.5 block truncate text-center font-mono text-[8px] text-t400">
                      {r.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && <div className="text-[11.5px] text-danger">{error}</div>}
        <button
          onClick={submit}
          disabled={pending || !prompt.trim()}
          className="min-h-[52px] w-full rounded-lg bg-violet-500 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-50"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {pending ? "Отправка…" : `Сгенерировать раскадровку · ${credits} кр`}
        </button>
      </div>

      {/* ---------- Задачи в работе ---------- */}
      {data.pendingCount > 0 && (
        <div
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-[rgba(192,138,62,.35)]"
          style={{
            background:
              "repeating-linear-gradient(135deg, var(--ink-700) 0 12px, var(--ink-600) 12px 24px)",
          }}
        >
          <span className="pulse-amber h-2 w-2 rounded-full bg-warning" />
          <span className="font-mono text-[10px] text-t300">
            {data.pendingCount} лист(а) рисуется — появится автоматически
          </span>
        </div>
      )}

      {/* ---------- Листы ---------- */}
      {data.sheets.length === 0 && data.orphanFrames.length === 0 && data.pendingCount === 0 && (
        <EmptyState>
          Листов пока нет. Выберите область (вся серия или шот), количество кадров и нажмите
          «Сгенерировать раскадровку».
        </EmptyState>
      )}

      {data.sheets.map((sheet) => (
        <div
          key={sheet.id}
          className="flex flex-col gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-violet-200">
              {sheet.token ?? "REF"}
            </span>
            <span className="rounded border border-[var(--border-subtle)] bg-ink-600 px-1.5 py-0.5 font-mono text-[9px] text-t300">
              {sheet.grid === 9 ? "3×3" : "2×2"}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-t400">
              {scopeLabel(sheet.sbShotId)}
            </span>
          </div>

          <button onClick={() => setDetail(sheet)} className="mx-auto block overflow-hidden rounded-lg bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet.url} alt={sheet.caption} className="max-h-[46dvh] w-auto object-contain" />
          </button>

          <div className="flex flex-wrap gap-1.5">
            {sheet.frames.length === 0 ? (
              <button
                onClick={() => doSlice(sheet)}
                disabled={pending}
                className="min-h-10 flex-1 rounded-lg bg-violet-500 px-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-violet-400 disabled:opacity-50"
                style={{ boxShadow: "var(--glow-violet-sm)" }}
              >
                {slicing === sheet.id ? "Режу…" : `✂ Разрезать на ${sheet.grid} кадров`}
              </button>
            ) : (
              <span className="flex min-h-10 flex-1 items-center justify-center rounded-lg border border-[var(--border-subtle)] font-mono text-[10px] text-t400">
                ✂ разрезан · {sheet.frames.length} кадров ниже
              </span>
            )}
            <button
              onClick={() => doUpscale(sheet)}
              disabled={pending}
              className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-[10.5px] font-semibold text-t200 hover:bg-ink-500 disabled:opacity-50"
            >
              ⤢ Upscale
            </button>
            <button
              onClick={() => {
                setDetail(sheet);
                setEditPrompt("");
                setEditOpen(true);
              }}
              disabled={pending}
              className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-[10.5px] font-semibold text-t200 hover:bg-ink-500 disabled:opacity-50"
            >
              ✎ Править
            </button>
            <ConfirmButton
              action={async () => deleteReference(sheet.id)}
              label="Удалить"
              confirmLabel="Точно удалить лист?"
              doneToast="Лист удалён (кадры остаются)"
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[10.5px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
            />
          </div>

          {sheet.frames.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sheet.frames.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setDetail(f)}
                  className="w-[58px] overflow-hidden rounded-md border border-[var(--border-subtle)] bg-black text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="" className="aspect-[9/16] w-full object-cover" />
                  <span className="block truncate px-1 py-0.5 text-center font-mono text-[7.5px] text-violet-200">
                    {f.token}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {data.orphanFrames.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel hint="их лист удалён — кадры живут сами">Отдельные кадры</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {data.orphanFrames.map((f) => (
              <button
                key={f.id}
                onClick={() => setDetail(f)}
                className="w-[58px] overflow-hidden rounded-md border border-[var(--border-subtle)] bg-black text-left hover:border-[var(--border-strong)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="aspect-[9/16] w-full object-cover" />
                <span className="block truncate px-1 py-0.5 text-center font-mono text-[7.5px] text-violet-200">
                  {f.token}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Детальный просмотр элемента ---------- */}
      <Sheet
        open={Boolean(detail) && !editOpen}
        onClose={() => setDetail(null)}
        title={detail?.token ?? "Элемент"}
      >
        {detail && (
          <div className="flex flex-col gap-3 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detail.url}
              alt=""
              className="max-h-[55dvh] w-full rounded-lg border border-[var(--border-subtle)] object-contain"
              style={{ background: "#000" }}
            />
            <div className="font-mono text-[10px] text-t400">{detail.caption}</div>
            <div className="flex gap-2">
              <button
                onClick={() => doUpscale(detail)}
                disabled={pending}
                className="min-h-[46px] flex-1 rounded-lg border border-[var(--border-default)] bg-ink-500 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-t100 hover:bg-ink-400 disabled:opacity-50"
              >
                ⤢ Upscale ×2 · 4 кр
              </button>
              <button
                onClick={() => {
                  setEditPrompt("");
                  setEditOpen(true);
                }}
                disabled={pending}
                className="min-h-[46px] flex-[1.2] rounded-lg bg-violet-500 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-violet-400 disabled:opacity-50"
                style={{ boxShadow: "var(--glow-violet-sm)" }}
              >
                ✎ Править · ≈6 кр
              </button>
            </div>
            <ConfirmButton
              action={async () => {
                await deleteReference(detail.id);
                setDetail(null);
              }}
              label="Удалить"
              confirmLabel="Точно удалить?"
              doneToast="Удалено"
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
            />
          </div>
        )}
      </Sheet>

      {/* ---------- Правка Nano Banana ---------- */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Правка ${detail?.token ?? ""} · ≈6 кр`}
      >
        <div className="flex flex-col gap-3 pb-2">
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Что изменить? («сделай план крупнее, добавь дождь…») Исходник не тронется — появится новый референс."
            className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 text-[13px] text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <button
            onClick={() => detail && doEdit(detail)}
            disabled={pending || !editPrompt.trim()}
            className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {pending ? "Отправка…" : "Создать правку (новый референс)"}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
