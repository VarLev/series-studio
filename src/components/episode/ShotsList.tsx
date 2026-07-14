"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveShot } from "@/lib/actions/shots";
import { deleteShot, deleteAllShots } from "@/lib/actions/deletes";
import { StatusPill, EmptyState } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import LongPressMenu from "@/components/LongPressMenu";
import InsertGroupSheet from "./InsertGroupSheet";
import LazyVideoThumb from "@/components/LazyVideoThumb";
import { useT } from "@/components/I18nProvider";

export interface ShotListItem {
  id: string;
  orderIndex: number;
  title: string;
  action: string;
  durationSec: number;
  timecode: string;
  status: string;
  /** начало новой сюжетной сцены (первая группа считается началом всегда) */
  sceneStart: boolean;
  /** вставная группа (спин-офф сцены): своя шкала времени и свои параметры */
  isInsert: boolean;
  /** номер группы в серии; вставные группы в нумерацию не входят (0 — номера нет) */
  displayNo: number;
  entityNames: string[];
  /** чистые визуальные описания шотов группы (без «Шот N (время):») — для промпта листа */
  beats: string[];
  /** миниатюра группы: кадр лучшего результата (★ последний, иначе первый готовый) */
  thumbUrl?: string | null;
  thumbIsVideo?: boolean;
}

/** Номер в бейджах и заголовках: у вставных групп своего номера серии нет. */
function groupLabel(shot: ShotListItem): string {
  return shot.isInsert ? "✦" : String(shot.displayNo).padStart(2, "0");
}

export default function ShotsList({
  episodeId,
  shots,
  defaultModel,
  useCli = false,
}: {
  episodeId: string;
  shots: ShotListItem[];
  /** модель по умолчанию для вставных групп (та же, что у раскадровки) */
  defaultModel: string;
  /** llm_use_cli на /costs — Claude-вызовы идут через подписку, не по цене API */
  useCli?: boolean;
}) {
  const t = useT();
  const [, startTransition] = useTransition();
  // «+» на разделителе сцены → шторка вставной группы для этой сцены
  const [insertFor, setInsertFor] = useState<{ shotId: string; scene: number } | null>(null);

  if (!shots.length) {
    return (
      <div className="p-4">
        <EmptyState>
          {t(
            "Групп пока нет. Вставьте литературный сюжет во вкладке «Сюжет» и нажмите «Разбить на группы шотов».",
            "No shot groups yet. Paste the literary story on the Story tab and press Break into shot groups.",
          )}
        </EmptyState>
      </div>
    );
  }

  // номера сцен: первая группа — всегда начало сцены, дальше по флагу sceneStart.
  // Считаем заранее, без мутации во время рендера (react-hooks/immutability).
  const sceneNoByIndex = shots.reduce<number[]>((acc, shot, i) => {
    const isSceneStart = i === 0 || shot.sceneStart;
    acc.push((i === 0 ? 0 : acc[i - 1]) + (isSceneStart ? 1 : 0));
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-2.5 p-4 pb-10">
      {shots.map((shot, i) => {
        const isSceneStart = i === 0 || shot.sceneStart;
        const scene = sceneNoByIndex[i];
        return (
        <div key={shot.id} className="flex flex-col gap-2.5">
          {/* разделитель сюжетных сцен: с этой группы связность с предыдущей не тянется */}
          {isSceneStart && (
            <div className="mt-1 flex items-center gap-2 first:mt-0">
              <span className="text-[12px] leading-none">🎬</span>
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-violet-300">
                {t("Сцена", "Scene")} {scene}
              </span>
              <span className="h-px flex-1 bg-[var(--border-default)]" />
              {/* вставная группа: новые шоты по запросу — в конец этой сцены */}
              <button
                aria-label={t("Добавить шоты в сцену", "Add shots to this scene")}
                title={t(
                  "Добавить в сцену вставную группу шотов (по вашему запросу)",
                  "Add an insert shot group to this scene (from your request)",
                )}
                onClick={() => setInsertFor({ shotId: shot.id, scene })}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-[13px] leading-none text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
              >
                +
              </button>
            </div>
          )}
        <LongPressMenu
          title={`${shot.isInsert ? t("Вставка", "Insert") : t("Группа", "Group")} ${groupLabel(shot)} · ${shot.title || t("Без названия", "Untitled")}`}
          deleteLabel={t("Удалить шот", "Delete shot")}
          confirmLabel={t(
            "Точно удалить шот с промптами и видео?",
            "Really delete this shot with its prompts and videos?",
          )}
          doneToast={t("Шот удалён", "Shot deleted")}
          action={deleteShot.bind(null, shot.id)}
          className={`flex items-stretch gap-2 rounded-xl border p-2.5 hover:border-[var(--border-strong)] ${
            shot.isInsert
              ? "border-dashed border-[rgba(139,95,176,.55)] bg-[rgba(139,95,176,.08)]"
              : "border-[var(--border-subtle)] bg-ink-700"
          }`}
        >
          <Link
            href={`/episodes/${episodeId}/shots/${shot.id}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <div className="relative flex aspect-[9/16] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600">
              {shot.thumbUrl ? (
                shot.thumbIsVideo ? (
                  <LazyVideoThumb
                    src={shot.thumbUrl}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shot.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )
              ) : (
                <span className="chrome-text font-display text-[16px] font-bold">
                  {groupLabel(shot)}
                </span>
              )}
              {/* когда есть кадр — номер группы маленьким бейджем в углу */}
              {shot.thumbUrl && (
                <span className="absolute left-0 top-0 rounded-br-md bg-[rgba(6,5,9,.82)] px-1 py-0.5 font-mono text-[8px] font-semibold text-t100">
                  {groupLabel(shot)}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(6,5,9,.85)] px-1 pb-0.5 pt-2 text-center font-mono text-[8.5px] font-semibold text-t200">
                {shot.durationSec}s
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-t100">
                {shot.title || shot.action.slice(0, 60) || t("Без названия", "Untitled")}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusPill status={shot.status} />
                {shot.isInsert && (
                  <span className="rounded bg-[rgba(139,95,176,.18)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-violet-200">
                    {t("вставка", "insert")}
                  </span>
                )}
                {shot.timecode && (
                  <span
                    className={`font-mono text-[9.5px] ${shot.isInsert ? "text-violet-300" : "text-t400"}`}
                    title={
                      shot.isInsert
                        ? t("своя шкала времени — в сквозной таймкод не входит", "own clock — not part of the episode timecode")
                        : undefined
                    }
                  >
                    {shot.isInsert ? "⎘ " : ""}
                    {shot.timecode}
                  </span>
                )}
                {shot.entityNames.length > 0 && (
                  <span className="truncate font-mono text-[9.5px] text-t400">
                    {shot.entityNames.join(" · ")}
                  </span>
                )}
              </div>
            </div>
          </Link>
          <div className="flex flex-col justify-center gap-1">
            <button
              aria-label="Выше"
              disabled={i === 0}
              onClick={() => startTransition(() => moveShot(shot.id, "up"))}
              className="flex h-8 w-8 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-t100 disabled:opacity-25"
            >
              ↑
            </button>
            <button
              aria-label="Ниже"
              disabled={i === shots.length - 1}
              onClick={() => startTransition(() => moveShot(shot.id, "down"))}
              className="flex h-8 w-8 items-center justify-center rounded-md text-t300 hover:bg-ink-500 hover:text-t100 disabled:opacity-25"
            >
              ↓
            </button>
          </div>
          {/* вставные группы — свободные, необязательные сцены: удаляются явной
              кнопкой, не только долгим зажатием (как обычные группы) */}
          {shot.isInsert && (
            <ConfirmButton
              action={deleteShot.bind(null, shot.id)}
              label="🗑"
              confirmLabel={t("Удалить вставку?", "Delete insert?")}
              doneToast={t("Вставка удалена", "Insert deleted")}
              className="flex w-8 items-center justify-center self-center rounded-md text-[13px] text-t400 hover:bg-ink-500 hover:text-danger disabled:opacity-50"
              armedClassName="bg-[rgba(194,71,106,.15)] text-danger"
            />
          )}
        </LongPressMenu>
        </div>
        );
      })}

      <div className="pt-1 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-t400">
        {t("долгое зажатие по шоту — удаление", "long-press a shot to delete")}
      </div>

      {shots.length > 1 && (
        <ConfirmButton
          action={deleteAllShots.bind(null, episodeId)}
          label={t(`Удалить все шоты (${shots.length})`, `Delete all shots (${shots.length})`)}
          confirmLabel={t("Точно удалить все шоты серии?", "Really delete all shots of this episode?")}
          doneToast={t("Шоты удалены", "Shots deleted")}
          className="mt-1 min-h-11 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
        />
      )}

      <InsertGroupSheet
        episodeId={episodeId}
        anchor={insertFor}
        onClose={() => setInsertFor(null)}
        defaultModel={defaultModel}
        baselineCount={shots.length}
        useCli={useCli}
      />
    </div>
  );
}
