"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import FilmStrip, { type StripShot } from "@/components/FilmStrip";

/**
 * Кинолента в layout'е карточки группы: подсветку текущей группы берём из
 * сегмента, а не из props — layout не перерендеривается при смене [shotId]
 * (в этом весь смысл: миниатюры серии считаются один раз, а не на каждый тап).
 */
export default function ShotFilmStrip({
  episodeId,
  shots,
}: {
  episodeId: string;
  shots: StripShot[];
}) {
  const currentShotId = useSelectedLayoutSegment() ?? undefined;
  return <FilmStrip episodeId={episodeId} shots={shots} currentShotId={currentShotId} />;
}
