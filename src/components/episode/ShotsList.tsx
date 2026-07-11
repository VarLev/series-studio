"use client";

import Link from "next/link";
import { useTransition } from "react";
import { moveShot } from "@/lib/actions/shots";
import { deleteShot, deleteAllShots } from "@/lib/actions/deletes";
import { StatusPill, EmptyState } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import LongPressMenu from "@/components/LongPressMenu";

export interface ShotListItem {
  id: string;
  orderIndex: number;
  title: string;
  action: string;
  durationSec: number;
  status: string;
  entityNames: string[];
}

export default function ShotsList({
  episodeId,
  shots,
}: {
  episodeId: string;
  shots: ShotListItem[];
}) {
  const [, startTransition] = useTransition();

  if (!shots.length) {
    return (
      <div className="p-4">
        <EmptyState>
          Групп пока нет. Напишите сюжет во вкладке «Сюжет» и нажмите «Разбить на шоты».
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 p-4 pb-10">
      {shots.map((shot, i) => (
        <LongPressMenu
          key={shot.id}
          title={`Группа ${String(shot.orderIndex).padStart(2, "0")} · ${shot.title || "Без названия"}`}
          deleteLabel="Удалить шот"
          confirmLabel="Точно удалить шот с промптами и видео?"
          doneToast="Шот удалён"
          action={deleteShot.bind(null, shot.id)}
          className="flex items-stretch gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-2.5 hover:border-[var(--border-strong)]"
        >
          <Link
            href={`/episodes/${episodeId}/shots/${shot.id}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <div className="relative flex aspect-[9/16] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600">
              <span className="chrome-text font-display text-[16px] font-bold">
                {String(shot.orderIndex).padStart(2, "0")}
              </span>
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(6,5,9,.85)] px-1 pb-0.5 pt-2 text-center font-mono text-[8.5px] font-semibold text-t200">
                {shot.durationSec}s
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-t100">
                {shot.title || shot.action.slice(0, 60) || "Без названия"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusPill status={shot.status} />
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
        </LongPressMenu>
      ))}

      <div className="pt-1 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-t400">
        долгое зажатие по шоту — удаление
      </div>

      {shots.length > 1 && (
        <ConfirmButton
          action={deleteAllShots.bind(null, episodeId)}
          label={`Удалить все шоты (${shots.length})`}
          confirmLabel="Точно удалить все шоты серии?"
          doneToast="Шоты удалены"
          className="mt-1 min-h-11 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
        />
      )}
    </div>
  );
}
