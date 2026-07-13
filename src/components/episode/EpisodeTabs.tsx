"use client";

import { useState } from "react";
import SynopsisEditor from "./SynopsisEditor";
import ShotsList, { type ShotListItem } from "./ShotsList";
import StoryboardTab, { type StoryboardData } from "./StoryboardTab";
import { useT } from "@/components/I18nProvider";

const TABS = [
  { id: "Сюжет", ru: "Сюжет", en: "Story" },
  { id: "Раскадровка", ru: "Раскадровка", en: "Storyboard" },
  { id: "Шоты", ru: "Шоты", en: "Shots" },
] as const;

export default function EpisodeTabs({
  episodeId,
  initialTitle,
  initialLogline,
  initialSynopsis,
  shots,
  breakdownModel,
  storyboard,
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shots: ShotListItem[];
  breakdownModel: string;
  storyboard: StoryboardData;
}) {
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(
    shots.length > 0 ? "Шоты" : "Сюжет",
  );
  // выбор модели живёт здесь, а не в SynopsisEditor: переключение вкладок
  // размонтирует редактор, и выбор терялся (замечание заказчика)
  const [bdModel, setBdModel] = useState(breakdownModel);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 border-b border-[var(--border-subtle)] px-3.5 py-2">
        {TABS.map((tabDef) => {
          const active = tab === tabDef.id;
          const base = t(tabDef.ru, tabDef.en);
          const label = tabDef.id === "Шоты" && shots.length ? `${base} · ${shots.length}` : base;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className="min-h-[38px] flex-1 rounded-md border px-1 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
              style={{
                borderColor: active ? "var(--border-strong)" : "transparent",
                background: active ? "var(--ink-600)" : "none",
                color: active ? "var(--text-100)" : "var(--text-400)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === "Сюжет" && (
        <SynopsisEditor
          episodeId={episodeId}
          initialTitle={initialTitle}
          initialLogline={initialLogline}
          initialSynopsis={initialSynopsis}
          shotsCount={shots.length}
          shotTitles={shots.map((s) => s.title)}
          breakdownModel={bdModel}
          onBreakdownModelChange={setBdModel}
        />
      )}

      {tab === "Раскадровка" && (
        <StoryboardTab episodeId={episodeId} shots={shots} data={storyboard} />
      )}

      {/* вставные группы создаются той же моделью, что выбрана для раскадровки */}
      {tab === "Шоты" && <ShotsList episodeId={episodeId} shots={shots} defaultModel={bdModel} />}
    </div>
  );
}
