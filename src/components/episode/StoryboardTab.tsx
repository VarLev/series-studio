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

export interface AttachRef {
  id: string;
  url: string;
  label: string;
  /** character | location | prop | style | series — определяет роль в промпте */
  kind: string;
  name: string;
}

export interface StoryboardData {
  sheets: StoryboardSheetData[];
  orphanFrames: StoryboardItem[]; // кадры, чей лист уже удалён
  attachRefs: AttachRef[];
  pendingCount: number;
  /** Шаблон промпта листа из настроек (tpl_storyboard, с плейсхолдерами). */
  template: string;
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

const PANEL_STRUCTURE_9 = `1. Introduction – establish the scene and mood.
2. Character motivation – show intention or desire.
3. First action – the story begins moving.
4. Rising tension – complication appears.
5. Turning point – dramatic or emotional shift.
6. Escalation – action intensifies.
7. Climax – peak emotional or action moment.
8. Resolution – consequences or aftermath.
9. Final frame – strong cinematic ending shot.`;

const PANEL_STRUCTURE_4 = `1. Introduction – establish the scene, mood and character intention.
2. Rising tension – the story moves, a complication appears.
3. Climax – peak emotional or action moment.
4. Final frame – resolution, strong cinematic ending shot.`;

/** Строка роли референса по типу и порядку прикрепления (требование заказчика). */
function refLine(n: number, r: AttachRef): string {
  switch (r.kind) {
    case "character":
      return `Use reference image ${n} as the locked character sheet for ${r.name} — keep the exact face, hair and outfit.`;
    case "location":
      return `Use reference image ${n} as the environment and location reference (${r.name}).`;
    case "prop":
      return `Use reference image ${n} as the exact prop reference (${r.name}).`;
    case "style":
      return `Use reference image ${n} only as the visual style reference — do not copy its composition.`;
    default:
      return `Use reference image ${n} as a frame and composition reference (${r.name}).`;
  }
}

function buildStory(scope: ShotListItem | null, frames: number, shots: ShotListItem[]): string {
  if (scope) {
    return (
      `Scene (${scope.durationSec}s): ${scope.title ? scope.title + ". " : ""}${trimText(scope.action, 400)}\n` +
      `The panels show the progression of this single scene moment by moment, with varied cinematic camera angles (wide, medium, close-up).`
    );
  }
  const picked = evenPick(shots, frames);
  if (!picked.length) return "[опишите историю — по биту на панель]";
  const lines = picked.map(
    (s, i) => `${i + 1}. ${s.title ? s.title + " — " : ""}${trimText(s.action, 160)}`,
  );
  const tail =
    picked.length < frames
      ? `\nDistribute these beats across all ${frames} panels, expanding key moments into additional angles.`
      : "";
  return lines.join("\n") + tail;
}

/** Сборка промпта листа из шаблона настроек: плейсхолдеры → значения. */
function buildPrompt(
  template: string,
  scope: ShotListItem | null,
  frames: number,
  shots: ShotListItem[],
  attached: AttachRef[],
): string {
  const refLines = attached.map((r, i) => refLine(i + 1, r)).join("\n");
  const story = buildStory(scope, frames, shots);
  const fill: Record<string, string> = {
    "{{GRID}}": frames === 9 ? "3x3" : "2x2",
    "{{PANELS}}": String(frames),
    "{{REFERENCES}}": refLines,
    "{{STORY}}": story,
    "{{PANEL_STRUCTURE}}": frames === 9 ? PANEL_STRUCTURE_9 : PANEL_STRUCTURE_4,
  };
  let out = template;
  for (const [key, value] of Object.entries(fill)) out = out.split(key).join(value);
  // шаблон без плейсхолдеров не должен терять сюжет и референсы
  if (!template.includes("{{STORY}}")) out += `\n\nStory to visualize:\n${story}`;
  if (!template.includes("{{REFERENCES}}") && refLines) out += `\n\n${refLines}`;
  return out.replace(/\n{3,}/g, "\n\n").trim();
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
  const attachedRefs = useMemo(
    () =>
      attach
        .map((id) => data.attachRefs.find((r) => r.id === id))
        .filter((r): r is AttachRef => Boolean(r)),
    [attach, data.attachRefs],
  );
  const autoPrompt = useMemo(
    () => buildPrompt(data.template, scope, frames, shots, attachedRefs),
    [data.template, scope, frames, shots, attachedRefs],
  );
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
            <SectionLabel hint="порядок = номер референса в промпте">
              Приложить референсы
            </SectionLabel>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {data.attachRefs.map((r) => {
                const order = attach.indexOf(r.id);
                const on = order >= 0;
                return (
                  <button
                    key={r.id}
                    onClick={() =>
                      setAttach((prev) => (on ? prev.filter((x) => x !== r.id) : [...prev, r.id]))
                    }
                    className="w-[48px] shrink-0"
                  >
                    <span
                      className="relative block aspect-[9/16] overflow-hidden rounded-md border-2"
                      style={{ borderColor: on ? "var(--violet-400)" : "var(--border-subtle)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="h-full w-full object-cover" />
                      {on && (
                        <span className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 font-mono text-[9px] font-bold text-white">
                          {order + 1}
                        </span>
                      )}
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
