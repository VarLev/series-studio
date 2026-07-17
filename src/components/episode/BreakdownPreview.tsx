"use client";

import { useMemo, useState } from "react";
import type { Breakdown } from "@/lib/llm/contracts";
import { fmtTime, overflowSec, GROUP_MAX_SEC } from "@/lib/beatsPure";
import { useT } from "@/components/I18nProvider";

type Group = Breakdown["groups"][number];
type Item = Group & { included: boolean; duplicate: boolean };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\wа-яё]+/gi, " ").trim();
}

/**
 * Реплики, найденные в литературном сюжете: кавычки-ёлочки, обычные и англ.
 * Короткие вставки в кавычках («Ашфорд») репликами не считаем — порог по словам.
 */
function quotedLines(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(/«([^»]{2,400})»|"([^"]{2,400})"|"([^"]{2,400})"/g)) {
    const line = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (line.split(/\s+/).filter(Boolean).length >= 3) out.push(line);
  }
  return out;
}

/** Сравнение реплик по «скелету»: без пунктуации, регистра и лишних пробелов. */
function speechKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Предпросмотр раскадровки v2: группы шотов (единицы генерации ≤15 сек)
 * с шотами и таймингом внутри. Пользователь подтверждает/правит перед
 * созданием карточек. Spec §2.2: повторный запуск не дублирует готовые
 * группы — похожие на существующие помечаются и по умолчанию выключены.
 */
export default function BreakdownPreview({
  breakdown,
  existingTitles,
  existingActions = [],
  synopsis = "",
  durationRange,
  onCancel,
  onConfirm,
  onEdited,
}: {
  breakdown: Breakdown;
  existingTitles: string[];
  /** действия первых шотов существующих групп — второй признак дубля, кроме названия */
  existingActions?: string[];
  /** литературный сюжет — для проверки, что реплики из него не потерялись */
  synopsis?: string;
  /** целевой хронометраж эпизода (мин) с бегунка — с чем сверять итог */
  durationRange?: [number, number];
  onCancel: () => void;
  onConfirm: (confirmed: Breakdown, mode: "append" | "replace") => Promise<void>;
  /** Правки полей предпросмотра — родитель сохраняет их (localStorage), чтобы не терять. */
  onEdited?: (b: Breakdown) => void;
}) {
  const t = useT();
  const existing = useMemo(() => new Set(existingTitles.map(normalize).filter(Boolean)), [existingTitles]);
  const existingAct = useMemo(
    () => new Set(existingActions.map(normalize).filter(Boolean)),
    [existingActions],
  );
  const hasExisting = existingTitles.length > 0;
  const [mode, setMode] = useState<"append" | "replace">(hasExisting ? "append" : "replace");
  const [items, setItems] = useState<Item[]>(() =>
    [...breakdown.groups]
      .sort((a, b) => a.order - b.order)
      .map((g) => {
        // дубль ловим и по названию, и по действию первого шота: модель часто
        // чуть перефразирует заголовок, и сравнение только по нему промахивалось
        const firstAction = normalize(g.shots[0]?.action ?? "");
        const duplicate =
          hasExisting &&
          (existing.has(normalize(g.title)) || (Boolean(firstAction) && existingAct.has(firstAction)));
        return { ...g, duplicate, included: !duplicate };
      }),
  );
  const [saving, setSaving] = useState(false);

  const strip = (item: Item): Group => ({
    order: item.order,
    title: item.title,
    time: item.time,
    duration_sec: item.duration_sec,
    location: item.location,
    time_weather: item.time_weather,
    emotional_tone: item.emotional_tone,
    scene_start: item.scene_start,
    characters: item.characters,
    wardrobe: item.wardrobe,
    shots: item.shots,
  });

  const emit = (next: Item[]) =>
    onEdited?.({
      summary: breakdown.summary,
      characters: breakdown.characters,
      locations: breakdown.locations,
      groups: next.map(strip),
    });

  function patch(i: number, p: Partial<Item>) {
    const next = items.map((item, idx) => (idx === i ? { ...item, ...p } : item));
    setItems(next);
    emit(next);
  }

  function patchShot(i: number, si: number, p: Partial<Group["shots"][number]>) {
    const next = items.map((item, idx) =>
      idx === i
        ? { ...item, shots: item.shots.map((s, sIdx) => (sIdx === si ? { ...s, ...p } : s)) }
        : item,
    );
    setItems(next);
    emit(next);
  }

  /** Убрать лишний шот прямо в предпросмотре — не заводя группу ради правки. */
  function dropShot(i: number, si: number) {
    const next = items.map((item, idx) =>
      idx === i
        ? {
            ...item,
            shots: item.shots
              .filter((_, sIdx) => sIdx !== si)
              .map((s, k) => ({ ...s, order: k + 1 })),
          }
        : item,
    );
    setItems(next);
    emit(next);
  }

  const included = items.filter((i) => i.included);
  // Итог хронометража против цели с бегунка: без него нельзя понять, уложилась ли
  // модель в заказанные минуты — а это первое, что нужно знать до подтверждения.
  const totalSec = included.reduce((n, g) => n + g.duration_sec, 0);
  const target = durationRange;
  const inTarget = target ? totalSec >= target[0] * 60 && totalSec <= target[1] * 60 : true;

  // Группы, где реплики не помещаются в одну видеогенерацию: сохранение подрежет
  // их до 15 сек, и хвост реплики в видео не попадёт. Раньше кламп был тихим.
  const overflowing = included.filter((g) => overflowSec(g.shots) > 0);

  // Реплики сюжета, не попавшие ни в один шот. Проверка детерминированная и
  // бесплатная, а потерянная реплика в диалоговой драме — худший тихий брак.
  const lostLines = useMemo(() => {
    // считаем от items (state), а не от производного included: у производного
    // массива новая ссылка на каждый рендер, и React Compiler не может сохранить
    // мемоизацию с такой зависимостью
    const said = items
      .filter((g) => g.included)
      .flatMap((g) => g.shots.map((s) => speechKey(s.dialogue)))
      .filter(Boolean);
    return quotedLines(synopsis).filter((line) => {
      const key = speechKey(line);
      return key && !said.some((d) => d.includes(key) || key.includes(d));
    });
  }, [items, synopsis]);

  async function confirm() {
    setSaving(true);
    const confirmed = included.map((item, idx) => ({ ...strip(item), order: idx + 1 }));
    await onConfirm(
      {
        summary: breakdown.summary,
        characters: breakdown.characters,
        locations: breakdown.locations,
        groups: confirmed,
      },
      mode,
    );
    setSaving(false);
  }

  const includedCount = included.length;
  const totalShots = included.reduce((n, g) => n + g.shots.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4 pb-32">
        <div className="mb-3 text-[11px] leading-relaxed text-t400">
          <span className="text-violet-600">✦</span>&nbsp;{" "}
          {t(
            `Claude предложил ${items.length} групп (${items.reduce((n, g) => n + g.shots.length, 0) } шотов). Тайминг уже пересчитан по формуле речи — именно эти цифры и сохранятся.`,
            `Claude proposed ${items.length} groups (${items.reduce((n, g) => n + g.shots.length, 0)} shots). Timing is already recomputed by the speech formula — these exact numbers are what gets saved.`,
          )}
        </div>

        {/* Итог против цели: уложилась ли модель в заказанный хронометраж */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5">
          <span className="text-[11px] text-t400">{t("Итого:", "Total:")}</span>
          <span className="font-mono text-[13px] font-semibold text-t100">{fmtTime(totalSec)}</span>
          {target && (
            <span
              className="font-mono text-[10px]"
              style={{ color: inTarget ? "var(--success)" : "var(--warning)" }}
            >
              {inTarget ? "✓" : "!"} {t("цель", "target")} {target[0]}–{target[1]} {t("мин", "min")}
            </span>
          )}
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-t400">
            {includedCount} {t("групп", "groups")} · {totalShots} {t("шотов", "shots")}
          </span>
        </div>

        {overflowing.length > 0 && (
          <div className="mb-3 rounded-lg border border-[rgba(192,138,62,.4)] bg-[rgba(192,138,62,.07)] px-3 py-2 text-[10.5px] leading-relaxed text-warning">
            {t(
              `Реплики не помещаются в ${GROUP_MAX_SEC} сек в группах: ${overflowing.map((g) => items.indexOf(g) + 1).join(", ")}. При сохранении такие группы подрежутся до ${GROUP_MAX_SEC} сек — хвост реплики в видео не попадёт. Лучше разделить материал на несколько групп.`,
              `Dialogue doesn't fit ${GROUP_MAX_SEC}s in groups: ${overflowing.map((g) => items.indexOf(g) + 1).join(", ")}. On save they are clamped to ${GROUP_MAX_SEC}s — the tail of the line won't make it into the video. Better to split the material across groups.`,
            )}
          </div>
        )}

        {lostLines.length > 0 && (
          <div className="mb-3 rounded-lg border border-[rgba(192,138,62,.4)] bg-[rgba(192,138,62,.07)] px-3 py-2 text-[10.5px] leading-relaxed text-warning">
            <div className="mb-1 font-semibold">
              {t(
                `Реплик из сюжета не попало в раскадровку: ${lostLines.length}`,
                `Lines from the story missing in the breakdown: ${lostLines.length}`,
              )}
            </div>
            {lostLines.slice(0, 4).map((line, i) => (
              <div key={i} className="truncate font-mono text-[9.5px] text-t300">
                «{line}»
              </div>
            ))}
            {lostLines.length > 4 && (
              <div className="font-mono text-[9.5px] text-t400">
                {t(`…и ещё ${lostLines.length - 4}`, `…and ${lostLines.length - 4} more`)}
              </div>
            )}
          </div>
        )}

        {/* Карточка сверки: пересказ сюжета глазами модели + персонажи и локации,
            которые она вычитала. Ничего не сохраняет (saveBreakdown берёт только
            groups) и группой шотов НЕ является — нужна ровно чтобы поймать
            неверно понятый сюжет ДО подтверждения. Без подписи её принимали за
            первый блок раскадровки. */}
        {(breakdown.summary || breakdown.characters.length > 0 || breakdown.locations.length > 0) && (
          <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3">
            <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-t400">
              {t("Как модель поняла сюжет", "How the model read the story")}
              <span className="ml-1.5 normal-case tracking-normal opacity-70">
                {t(
                  "· сверка перед подтверждением, не сохраняется и шотом не станет",
                  "· a check before you confirm — not saved, never becomes a shot",
                )}
              </span>
            </div>
            {breakdown.summary && (
              <div className="text-[11.5px] leading-relaxed text-t200">{breakdown.summary}</div>
            )}
            {(breakdown.characters.length > 0 || breakdown.locations.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {breakdown.characters.map((c) => (
                  <span
                    key={`c-${c}`}
                    className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-violet-200"
                  >
                    {c}
                  </span>
                ))}
                {breakdown.locations.map((l) => (
                  <span
                    key={`l-${l}`}
                    className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300"
                  >
                    📍 {l}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {hasExisting && (
          <div className="mb-3 flex gap-1.5">
            <button
              onClick={() => setMode("append")}
              className="min-h-9 flex-1 rounded-md border px-2 text-[10.5px] font-semibold"
              style={{
                borderColor: mode === "append" ? "var(--border-strong)" : "var(--border-subtle)",
                background: mode === "append" ? "var(--ink-600)" : "none",
                color: mode === "append" ? "var(--text-100)" : "var(--text-400)",
              }}
            >
              {t("Добавить новые (готовые не трогать)", "Add new (keep existing)")}
            </button>
            <button
              onClick={() => setMode("replace")}
              className="min-h-9 flex-1 rounded-md border px-2 text-[10.5px] font-semibold"
              style={{
                borderColor: mode === "replace" ? "rgba(194,71,106,.5)" : "var(--border-subtle)",
                background: mode === "replace" ? "rgba(194,71,106,.08)" : "none",
                color: mode === "replace" ? "#e08aa4" : "var(--text-400)",
              }}
            >
              {t(`Заменить все (${existingTitles.length})`, `Replace all (${existingTitles.length})`)}
            </button>
          </div>
        )}
        {mode === "replace" && hasExisting && (
          <div className="mb-3 text-[10.5px] text-warning">
            {t(
              "Существующие группы, их промпты и связи будут удалены.",
              "Existing groups with their prompts and links will be deleted.",
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-lg border bg-ink-700 p-3"
              style={{
                opacity: item.included ? 1 : 0.45,
                borderColor:
                  item.duplicate && mode === "append"
                    ? "rgba(192,138,62,.4)"
                    : "var(--border-subtle)",
              }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.included}
                  onChange={(e) => patch(i, { included: e.target.checked })}
                  className="h-5 w-5 accent-[var(--violet-400)]"
                />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-t400">
                  {t("Группа", "Group")} {String(i + 1).padStart(2, "0")} · {item.duration_sec}{" "}
                  {t("сек", "sec")}
                </span>
                {overflowSec(item.shots) > 0 && (
                  <span
                    title={t(
                      "Реплики длиннее лимита одной видеогенерации — при сохранении группа подрежется",
                      "Dialogue is longer than one video generation allows — the group will be clamped on save",
                    )}
                    className="rounded bg-[rgba(192,138,62,.14)] px-1.5 py-0.5 text-[8px] font-semibold uppercase text-warning"
                  >
                    {t(`+${overflowSec(item.shots)} сек сверх лимита`, `+${overflowSec(item.shots)}s over limit`)}
                  </span>
                )}
                {item.duplicate && mode === "append" && (
                  <span className="rounded bg-[rgba(192,138,62,.14)] px-1.5 py-0.5 text-[8px] font-semibold uppercase text-warning">
                    {t("похожа на существующую", "similar to an existing one")}
                  </span>
                )}
              </div>
              <input
                value={item.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                placeholder={t("Название группы", "Group title")}
                className="mb-1.5 w-full rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
              />
              {/* локация правится тут же: она уходит на всю сюжетную связку, и
                  чинить её потом в каждой группе — лишняя работа */}
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] leading-none">📍</span>
                <input
                  value={item.location}
                  onChange={(e) => patch(i, { location: e.target.value })}
                  placeholder={t("Локация группы", "Group location")}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10px] text-t300 outline-none placeholder:text-t400 focus:border-[var(--border-strong)] focus:bg-ink-700"
                />
                {item.characters.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[10px] text-violet-200"
                  >
                    {c}
                  </span>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                {item.shots.map((shot, si) => (
                  <div
                    key={si}
                    className="rounded-md border border-[var(--border-subtle)] bg-ink-800 p-2"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
                        {t("Шот", "Shot")} {shot.order}
                        {shot.time ? ` · ${shot.time}` : ""}
                      </span>
                      <span className="flex-1" />
                      {item.shots.length > 1 && (
                        <button
                          aria-label={t("Удалить шот", "Delete shot")}
                          title={t("Удалить шот из группы", "Remove this shot from the group")}
                          onClick={() => dropShot(i, si)}
                          className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-t400 hover:bg-ink-600 hover:text-danger"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {(shot.framing || shot.camera) && (
                      <div className="mb-1 font-mono text-[10px] leading-relaxed text-t400">
                        {shot.framing && <>🎥 {shot.framing}</>}
                        {shot.framing && shot.camera && " · "}
                        {shot.camera}
                      </div>
                    )}
                    <textarea
                      value={shot.action}
                      onChange={(e) => patchShot(i, si, { action: e.target.value })}
                      rows={2}
                      placeholder={t("Действие и эмоция", "Action & emotion")}
                      className="w-full resize-y rounded border border-transparent bg-transparent px-1 py-0.5 text-[11.5px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)] focus:bg-ink-700"
                    />
                    <input
                      value={shot.dialogue}
                      onChange={(e) => patchShot(i, si, { dialogue: e.target.value })}
                      placeholder={t("Реплика (если есть)", "Dialogue (if any)")}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11.5px] text-violet-200 outline-none placeholder:text-t400 focus:border-[var(--border-strong)] focus:bg-ink-700"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        // мобайл: над общим таб-баром (58px + safe-area); десктоп: у низа окна
        className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-lg gap-2 border-t border-[var(--border-default)] px-3 py-3 md:max-w-3xl lg:bottom-0 lg:left-56 lg:mx-0 lg:max-w-none"
        style={{
          background: "linear-gradient(180deg, rgba(15,12,22,.94), rgba(6,5,9,.98))",
          backdropFilter: "blur(14px)",
        }}
      >
        <button
          onClick={onCancel}
          className="min-h-[50px] rounded-lg border border-[var(--border-default)] px-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-t200 hover:bg-ink-500"
        >
          {t("Отмена", "Cancel")}
        </button>
        <button
          onClick={confirm}
          disabled={saving || includedCount === 0}
          className="min-h-[50px] flex-1 rounded-lg text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-60"
          style={{
            background: mode === "replace" && hasExisting ? "var(--danger)" : "var(--violet-500)",
            boxShadow: mode === "replace" && hasExisting ? "none" : "var(--glow-violet-sm)",
          }}
        >
          {saving
            ? t("Создание…", "Creating…")
            : mode === "append" && hasExisting
              ? t(`Добавить ${includedCount} новых групп`, `Add ${includedCount} new groups`)
              : t(
                  `Создать ${includedCount} групп · ${fmtTime(totalSec)}`,
                  `Create ${includedCount} groups · ${fmtTime(totalSec)}`,
                )}
        </button>
      </div>
    </div>
  );
}
