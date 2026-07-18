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
  useCli = false,
  useCliGpt = false,
  storyboard,
}: {
  episodeId: string;
  initialTitle: string;
  initialLogline: string;
  initialSynopsis: string;
  shots: ShotListItem[];
  breakdownModel: string;
  /** llm_use_cli на /costs — Claude-вызовы идут через подписку, не по цене API */
  useCli?: boolean;
  /** llm_use_cli_gpt на /costs — GPT-вызовы идут через подписку ChatGPT (Codex CLI) */
  useCliGpt?: boolean;
  storyboard: StoryboardData;
}) {
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(
    shots.length > 0 ? "Шоты" : "Сюжет",
  );
  /**
   * Пока сюжет не разбит на группы, «Раскадровка» и «Шоты» пусты и делать там
   * нечего — держим их закрытыми, чтобы не отправлять в тупик. Активную вкладку
   * ВЫВОДИМ, а не синхронизируем состоянием: если группы исчезнут (replace-разбивка,
   * удаление), запертая вкладка не должна остаться открытой.
   */
  const noShots = shots.length === 0;
  const activeTab = noShots ? "Сюжет" : tab;
  const lockHint = t(
    "Сначала разбейте сюжет на группы шотов",
    "Break the story into shot groups first",
  );
  // выбор модели живёт здесь, а не в SynopsisEditor: переключение вкладок
  // размонтирует редактор, и выбор терялся (замечание заказчика)
  const [bdModel, setBdModel] = useState(breakdownModel);
  // область раскадровки живёт здесь: «▦» на карточке группы открывает вкладку
  // «Раскадровка» с уже выбранной группой ("" = вся серия)
  const [sbScopeId, setSbScopeId] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 border-b border-[var(--border-subtle)] px-3.5 py-2">
        {TABS.map((tabDef) => {
          const active = activeTab === tabDef.id;
          const locked = noShots && tabDef.id !== "Сюжет";
          const base = t(tabDef.ru, tabDef.en);
          const label = tabDef.id === "Шоты" && shots.length ? `${base} · ${shots.length}` : base;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              disabled={locked}
              title={locked ? lockHint : undefined}
              className="min-h-[38px] flex-1 rounded-md border px-1 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] disabled:cursor-not-allowed"
              style={{
                borderColor: active ? "var(--border-strong)" : "transparent",
                background: active ? "var(--ink-600)" : "none",
                color: active ? "var(--text-100)" : "var(--text-400)",
                opacity: locked ? 0.35 : 1,
              }}
            >
              {locked ? `🔒 ${label}` : label}
            </button>
          );
        })}
      </div>

      {activeTab === "Сюжет" && (
        <SynopsisEditor
          episodeId={episodeId}
          initialTitle={initialTitle}
          initialLogline={initialLogline}
          initialSynopsis={initialSynopsis}
          shotsCount={shots.length}
          shotTitles={shots.map((s) => s.title)}
          // действие первого шота группы — второй признак дубля при повторной разбивке
          shotActions={shots.map((s) => s.beats[0] ?? s.action)}
          breakdownModel={bdModel}
          onBreakdownModelChange={setBdModel}
          useCli={useCli}
          useCliGpt={useCliGpt}
        />
      )}

      {activeTab === "Раскадровка" && (
        <StoryboardTab
          episodeId={episodeId}
          shots={shots}
          data={storyboard}
          scopeId={sbScopeId}
          onScopeChange={setSbScopeId}
        />
      )}

      {/* вставные группы создаются той же моделью, что выбрана для раскадровки */}
      {activeTab === "Шоты" && (
        <ShotsList
          episodeId={episodeId}
          shots={shots}
          defaultModel={bdModel}
          useCli={useCli}
          useCliGpt={useCliGpt}
          onStoryboard={(shotId) => {
            setSbScopeId(shotId);
            setTab("Раскадровка");
          }}
        />
      )}
    </div>
  );
}
