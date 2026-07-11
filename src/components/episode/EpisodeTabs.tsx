"use client";

import { useState } from "react";
import SynopsisEditor from "./SynopsisEditor";
import ShotsList, { type ShotListItem } from "./ShotsList";
import StoryboardTab, { type StoryboardData } from "./StoryboardTab";

const TABS = ["Сюжет", "Раскадровка", "Шоты"] as const;

export default function EpisodeTabs({
  episodeId,
  initialTitle,
  initialLogline,
  initialSynopsis,
  shots,
  synopsisModel,
  breakdownModel,
  storyboard,
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shots: ShotListItem[];
  synopsisModel: string;
  breakdownModel: string;
  storyboard: StoryboardData;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    shots.length > 0 ? "Шоты" : "Сюжет",
  );
  // выбор моделей живёт здесь, а не в SynopsisEditor: переключение вкладок
  // размонтирует редактор, и выбор терялся (замечание заказчика)
  const [synModel, setSynModel] = useState(synopsisModel);
  const [bdModel, setBdModel] = useState(breakdownModel);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 border-b border-[var(--border-subtle)] px-3.5 py-2">
        {TABS.map((t) => {
          const active = tab === t;
          const label = t === "Шоты" && shots.length ? `Шоты · ${shots.length}` : t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
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
          synopsisModel={synModel}
          breakdownModel={bdModel}
          onSynopsisModelChange={setSynModel}
          onBreakdownModelChange={setBdModel}
        />
      )}

      {tab === "Раскадровка" && (
        <StoryboardTab episodeId={episodeId} shots={shots} data={storyboard} />
      )}

      {tab === "Шоты" && <ShotsList episodeId={episodeId} shots={shots} />}
    </div>
  );
}
