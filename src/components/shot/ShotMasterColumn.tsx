"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { SHOT_STATUS } from "@/lib/statuses";
import LongPressMenu from "@/components/LongPressMenu";
import { deleteShot } from "@/lib/actions/deletes";
import { useT } from "@/components/I18nProvider";
import type { NavShot } from "@/lib/shotChrome";

/**
 * Master-колонка (spec §4, десктоп): список шотов серии слева от детали.
 * Как и шапка, живёт в layout'е — активную группу берёт из сегмента, а не из
 * props, поэтому при переключении групп список не перезапрашивается.
 */
export default function ShotMasterColumn({
  episodeId,
  shots,
}: {
  episodeId: string;
  shots: NavShot[];
}) {
  const t = useT();
  const shotId = useSelectedLayoutSegment();

  return (
    <aside className="hidden overflow-y-auto border-r border-[var(--border-subtle)] p-3 lg:block">
      <div className="section-label mb-2">{t("Шоты серии", "Episode shots")}</div>
      <div className="flex flex-col gap-1.5">
        {shots.map((s) => {
          const st = SHOT_STATUS[s.status] ?? SHOT_STATUS.draft;
          const active = s.id === shotId;
          const sLabel = s.isInsert ? "✦" : String(s.displayNo).padStart(2, "0");
          const groupTitle = s.isInsert
            ? t("Вставная группа", "Insert group")
            : `${t("Группа", "Group")} ${sLabel}`;
          return (
            // долгое зажатие / правый клик по элементу → меню с «Удалить группу»
            <LongPressMenu
              key={s.id}
              title={s.title ? `${groupTitle} · ${s.title}` : groupTitle}
              deleteLabel={t("Удалить группу", "Delete group")}
              confirmLabel={t("Точно удалить эту группу и все её данные?", "Really delete this group and all its data?")}
              doneToast={t("Группа удалена", "Group deleted")}
              action={() => deleteShot(s.id)}
            >
            <Link
              href={`/episodes/${episodeId}/shots/${s.id}`}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                s.isInsert ? "border-dashed" : ""
              }`}
              style={{
                borderColor: active
                  ? "var(--border-strong)"
                  : s.isInsert
                    ? "rgba(139,95,176,.5)"
                    : "var(--border-subtle)",
                background: active
                  ? "var(--ink-600)"
                  : s.isInsert
                    ? "rgba(139,95,176,.08)"
                    : "none",
              }}
            >
              <span
                className="chrome-text font-display text-[13px] font-bold"
                style={s.isInsert ? { color: "var(--violet-300)" } : undefined}
              >
                {sLabel}
              </span>
              {s.isInsert ? (
                <span
                  className="rounded bg-[rgba(139,95,176,.18)] px-1 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.08em] text-violet-200"
                  title={t("Вставная группа", "Insert group")}
                >
                  {t("вставка", "insert")}
                </span>
              ) : (
                s.sceneStart && (
                  <span className="text-[10px] leading-none" title={t("Начало сцены", "Scene start")}>
                    🎬
                  </span>
                )
              )}
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-t200">
                {s.title || s.actionSnippet}
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "generating" ? "pulse-amber" : ""}`}
                style={{ background: st.color }}
              />
            </Link>
            </LongPressMenu>
          );
        })}
      </div>
    </aside>
  );
}
