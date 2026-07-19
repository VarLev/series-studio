"use client";

import { useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import UploadButton from "@/components/UploadButton";
import NanoBananaSheet from "@/components/refs/NanoBananaSheet";
import { toast } from "@/components/Toaster";
import {
  attachReferenceToShot,
  detachShotReference,
  setShotReferenceRole,
  analyzeShotReference,
} from "@/lib/actions/shots";
import { parseRefAnalysis } from "@/lib/refAnalysis";
import { useT } from "@/components/I18nProvider";
import type { ImageModelMeta } from "@/lib/imageModels";

interface ShotRef {
  id: string;
  url: string;
  caption: string;
  role: "start_frame" | "composition" | "layout";
  /** якорь в тексте промпта: @Start | @Comp1..N — связь картинки с промптом */
  anchor: string;
  /** анализ изображения (JSON {description,camera}) — показывается в слайдере деталей */
  analysis: string;
}

interface PickerRef {
  id: string;
  url: string;
  label: string;
  sub: string;
  /** кадр раскадровки ЭТОЙ группы — идёт первым и помечен бейджем */
  sb?: boolean;
}

const ROLE_LABEL = {
  start_frame: { ru: "start-frame", en: "start-frame" },
  composition: { ru: "композиция", en: "composition" },
  layout: { ru: "layout", en: "layout" },
} as const;

/** Референсы шота (spec §2.3/§3.6): роли, прикрепление из референсов серии/библии, Nano Banana. */
export default function ShotRefs({
  shotId,
  episodeId,
  refs,
  seriesRefs,
  bibleRefs,
  promptText,
  imageModels = [],
}: {
  shotId: string;
  episodeId: string;
  refs: ShotRef[];
  seriesRefs: PickerRef[];
  bibleRefs: PickerRef[];
  promptText: string;
  imageModels?: ImageModelMeta[];
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nanoOpen, setNanoOpen] = useState(false);
  const [, startTransition] = useTransition();
  const roleLabel = (role: keyof typeof ROLE_LABEL) => t(ROLE_LABEL[role].ru, ROLE_LABEL[role].en);

  // слайдер деталей референса: тап по миниатюре открывает его анализ
  const [detailFor, setDetailFor] = useState<ShotRef | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // локальные анализы (перекрывают props после дозапроса); ключ — id референса
  const [analyses, setAnalyses] = useState<Record<string, string>>({});
  const analysisOf = (r: ShotRef) => analyses[r.id] ?? r.analysis;

  async function openDetail(r: ShotRef) {
    setDetailFor(r);
    if (analysisOf(r).trim()) return; // анализ уже есть — показываем сразу
    // пусто → запрашиваем (vision-модель или кэш по файлу); слайдер покажет спиннер
    setAnalyzing(true);
    try {
      // до 2 попыток: ответ первой мог потеряться в туннеле, а анализ на сервере
      // уже сохранился (кэш по файлу) — повтор вернёт его мгновенно
      let res: Awaited<ReturnType<typeof analyzeShotReference>>;
      try {
        res = await analyzeShotReference(r.id);
      } catch {
        await new Promise((rs) => setTimeout(rs, 4000));
        res = await analyzeShotReference(r.id);
      }
      if (res.ok) setAnalyses((p) => ({ ...p, [r.id]: res.analysis }));
      else toast(res.error);
    } catch {
      toast(t("Не удалось получить анализ", "Failed to get the analysis"));
    } finally {
      setAnalyzing(false);
    }
  }

  const detailParsed = detailFor ? parseRefAnalysis(analysisOf(detailFor)) : null;

  function attach(refId: string) {
    startTransition(async () => {
      await attachReferenceToShot(shotId, refId, "composition");
      toast(t("Референс прикреплён (роль — композиция)", "Reference attached (role — composition)"));
    });
    setPickerOpen(false);
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {refs.map((r) => (
          <div key={r.id} className="w-[58px] shrink-0">
            <div className="relative aspect-[9/16] overflow-hidden rounded-md border-[1.5px] bg-ink-600"
              style={{
                borderColor: r.role === "start_frame" ? "rgba(192,138,62,.55)" : "var(--border-default)",
              }}
            >
              {/* тап по миниатюре → слайдер с подробной инфой (анализ референса) */}
              <button
                type="button"
                onClick={() => openDetail(r)}
                aria-label={t("Открыть детали референса", "Open reference details")}
                className="absolute inset-0 h-full w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.caption} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </button>
              {/* бейдж роли — только индикатор; тап по миниатюре открывает единый
                  слайдер (детали + смена роли). pointer-events-none — клик проходит
                  сквозь бейдж на кнопку миниатюры под ним */}
              <span
                className="pointer-events-none absolute left-0.5 top-0.5 z-10 rounded-[3px] border px-1 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: "rgba(6,5,9,.8)",
                  color:
                    r.role === "start_frame"
                      ? "var(--warning)"
                      : r.role === "layout"
                        ? "#6fc3d4"
                        : "var(--violet-200)",
                  borderColor:
                    r.role === "start_frame"
                      ? "rgba(192,138,62,.5)"
                      : r.role === "layout"
                        ? "rgba(111,195,212,.5)"
                        : "rgba(139,95,176,.5)",
                }}
              >
                {roleLabel(r.role)}
              </span>
              {/* значок «инфо» — намёк, что по миниатюре есть детали */}
              <span className="pointer-events-none absolute bottom-0.5 right-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[rgba(6,5,9,.8)] text-[8px] font-semibold text-t200">
                ⓘ
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-[8.5px] text-t400">
              {/* якорь = имя референса в тексте промпта (@Comp1 / @Start) */}
              {r.anchor && <span className="font-semibold text-violet-200">{r.anchor}</span>}
              {r.anchor && r.caption ? " · " : ""}
              {r.caption || (!r.anchor ? roleLabel(r.role) : "")}
            </div>
          </div>
        ))}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex aspect-[9/16] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[var(--border-default)] text-t300 hover:border-[var(--border-strong)] hover:text-violet-200"
        >
          <span className="text-[14px] leading-none">+</span>
          <span className="text-[8px] font-medium">{t("из референсов", "from references")}</span>
        </button>
      </div>

      {/* Прикрепление (spec §2.3): референсы серии + библии, Nano Banana, загрузка */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t("Прикрепить референс", "Attach reference")}>
        {seriesRefs.length > 0 && (
          <>
            <div className="section-label mb-2">{t("Референсы серии", "Episode references")}</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {seriesRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  title={r.sub}
                  className="overflow-hidden rounded-md border bg-ink-600 text-left hover:border-[var(--border-strong)]"
                  style={{
                    borderColor: r.sb ? "var(--violet-400)" : "var(--border-subtle)",
                  }}
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
                    {r.sb && (
                      <span className="absolute left-0 top-0 rounded-br bg-[rgba(6,5,9,.82)] px-1 py-0.5 font-mono text-[7.5px] font-semibold text-violet-200">
                        ▦ {t("раскадровка", "storyboard")}
                      </span>
                    )}
                  </div>
                  <div className="truncate px-1.5 py-1 font-mono text-[9px] text-violet-200">
                    {r.label}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {bibleRefs.length > 0 && (
          <>
            <div className="section-label mb-2">{t("Из библии (сущности шота)", "From the bible (shot entities)")}</div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {bibleRefs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-ink-600 text-left hover:border-[var(--border-strong)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" loading="lazy" decoding="async" className="aspect-[9/16] w-full object-cover" />
                  <div className="truncate px-1.5 py-1 text-[9px] text-t300">{r.label}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {!seriesRefs.length && !bibleRefs.length && (
          <div className="pb-2 text-[12px] text-t400">
            {t(
              "Референсов пока нет — нарисуйте Nano Banana или загрузите файл.",
              "No references yet — draw one with Nano Banana or upload a file.",
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setPickerOpen(false);
              setNanoOpen(true);
            }}
            className="min-h-11 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {t("Нарисовать новый · Nano Banana", "Draw new · Nano Banana")}
          </button>
          <UploadButton
            kind="reference"
            shotId={shotId}
            episodeId={episodeId}
            label={t("Загрузить файл с устройства", "Upload a file from device")}
          />
        </div>
      </Sheet>

      {/* Слайдер деталей референса: крупная картинка + сохранённый анализ */}
      <Sheet
        open={Boolean(detailFor)}
        onClose={() => setDetailFor(null)}
        title={t("Референс шота", "Shot reference")}
      >
        {detailFor && (
          <div className="flex flex-col gap-3 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detailFor.url}
              alt={detailFor.caption}
              className="max-h-[44vh] w-full rounded-lg border border-[var(--border-subtle)] object-contain"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  color:
                    detailFor.role === "start_frame"
                      ? "var(--warning)"
                      : detailFor.role === "layout"
                        ? "#6fc3d4"
                        : "var(--violet-200)",
                  borderColor:
                    detailFor.role === "start_frame"
                      ? "rgba(192,138,62,.5)"
                      : detailFor.role === "layout"
                        ? "rgba(111,195,212,.5)"
                        : "rgba(139,95,176,.5)",
                }}
              >
                {roleLabel(detailFor.role)}
              </span>
              {detailFor.anchor && (
                <span className="font-mono text-[10px] font-semibold text-violet-200">
                  {detailFor.anchor}
                </span>
              )}
              {detailFor.caption && (
                <span className="text-[11px] text-t300">{detailFor.caption}</span>
              )}
            </div>

            {/* Управление ролью референса — объединено сюда из отдельного слайдера */}
            <div className="flex flex-col gap-1.5">
              <div className="section-label">{t("Роль референса", "Reference role")}</div>
              <button
                onClick={() => {
                  const id = detailFor.id;
                  startTransition(async () => {
                    await setShotReferenceRole(id, "start_frame");
                    toast(t("Start-frame назначен · прежний стал композицией", "Start-frame set · the previous one became composition"));
                  });
                  setDetailFor(null);
                }}
                className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
                style={{
                  borderColor: detailFor.role === "start_frame" ? "var(--warning)" : "var(--border-subtle)",
                  background: detailFor.role === "start_frame" ? "rgba(192,138,62,.08)" : "none",
                }}
              >
                <span className="text-[12.5px] font-medium text-t100">Start-frame</span>
                <span className="text-[10px] text-t400">
                  {t(
                    "первый кадр видео · один на шот — прежний станет композицией",
                    "first frame of the video · one per shot — the previous one becomes composition",
                  )}
                </span>
              </button>
              <button
                onClick={() => {
                  const id = detailFor.id;
                  startTransition(async () => {
                    await setShotReferenceRole(id, "composition");
                    toast(t("Роль — референс композиции", "Role — composition reference"));
                  });
                  setDetailFor(null);
                }}
                className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
                style={{
                  borderColor: detailFor.role === "composition" ? "var(--border-strong)" : "var(--border-subtle)",
                  background: detailFor.role === "composition" ? "var(--ink-600)" : "none",
                }}
              >
                <span className="text-[12.5px] font-medium text-t100">
                  {t("Референс композиции", "Composition reference")}
                </span>
                <span className="text-[10px] text-t400">
                  {t(
                    "кадрирование / свет / настроение — уходит моделям вместе с промптом",
                    "framing / light / mood — sent to the models along with the prompt",
                  )}
                </span>
              </button>
              <button
                onClick={() => {
                  const id = detailFor.id;
                  startTransition(async () => {
                    await setShotReferenceRole(id, "layout");
                    toast(t("Роль — layout (только пространство)", "Role — layout (spatial only)"));
                  });
                  setDetailFor(null);
                }}
                className="flex min-h-12 flex-col items-start justify-center rounded-lg border px-3"
                style={{
                  borderColor: detailFor.role === "layout" ? "#6fc3d4" : "var(--border-subtle)",
                  background: detailFor.role === "layout" ? "rgba(111,195,212,.08)" : "none",
                }}
              >
                <span className="text-[12.5px] font-medium text-t100">
                  {t("Layout — только пространство", "Layout — spatial only")}
                </span>
                <span className="text-[10px] text-t400">
                  {t(
                    "геометрия комнаты и расстановка — БЕЗ копирования ракурса; видео начнётся с нового угла (привязка к прошлому без стартового кадра)",
                    "room layout & positions — WITHOUT copying the camera angle; the video starts from a new angle (ties to the previous shot without a start frame)",
                  )}
                </span>
              </button>
              <button
                onClick={() => {
                  const id = detailFor.id;
                  startTransition(async () => {
                    await detachShotReference(id);
                    toast(t("Откреплено от шота · референс остался в серии", "Detached from shot · reference stays in the episode"));
                  });
                  setDetailFor(null);
                }}
                className="min-h-11 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
              >
                {t("Открепить от шота", "Detach from shot")}
              </button>
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3">
              <div className="section-label mb-1.5">{t("Анализ изображения", "Image analysis")}</div>
              {analyzing ? (
                <div className="text-[11px] text-t400">
                  {t("Анализирую изображение…", "Analyzing the image…")}
                </div>
              ) : detailParsed ? (
                <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-t200">
                  {detailParsed.description && <div>{detailParsed.description}</div>}
                  {detailParsed.camera && (
                    <div className="text-t400">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em]">
                        {t("камера", "camera")}:
                      </span>{" "}
                      {detailParsed.camera}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-t400">
                  {t("Анализа пока нет.", "No analysis yet.")}
                </div>
              )}
            </div>

            <div className="text-[10px] leading-snug text-t400">
              {t(
                "Описание сохранено за референсом и уходит в Enhance и Rework. Открепление и повторное добавление в шот анализ заново не запускают.",
                "The description is stored with the reference and fed to Enhance and Rework. Detaching and re-adding to the shot won't re-run the analysis.",
              )}
            </div>
          </div>
        )}
      </Sheet>

      <NanoBananaSheet
        open={nanoOpen}
        onClose={() => setNanoOpen(false)}
        episodeId={episodeId}
        prefillPrompt={promptText}
        models={imageModels}
      />
    </>
  );
}
