import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import ShotChromeHeader from "@/components/shot/ShotChromeHeader";
import ShotFilmStrip from "@/components/shot/ShotFilmStrip";
import ShotMasterColumn from "@/components/shot/ShotMasterColumn";
import { SkFilmStrip, SkHeader, SkMasterColumn } from "@/components/Skeleton";
import { getEpisodeNumber, getShotNav, getStripShots } from "@/lib/shotChrome";

/**
 * Layout карточки группы шотов. Здесь живёт всё ОБЩЕЕ ДЛЯ СЕРИИ: шапка,
 * кинолента, master-колонка. Стоит сегментом выше меняющегося [shotId],
 * поэтому при переходе между группами не перезапрашивается и не размонтируется
 * — раньше каждый тап по группе заново тянул список шотов, батч подписанных
 * URL и проверку постера в хранилище на каждую группу (I/O по числу групп).
 *
 * Route-группа (card) нужна, чтобы этот layout НЕ накрыл соседей
 * [shotId]/editor и [shotId]/review — у них свои полноэкранные шапки
 * (route-groups.md: «Opting specific route segments into sharing a layout,
 * while keeping others out»).
 *
 * Каждый кусок хрома — своя Suspense-граница: loading.tsx лежит НИЖЕ layout'а и
 * фолбэк для его собственных запросов не показывает, так что без Suspense
 * первый вход в карточку блокировался бы на самой дорогой части — миниатюрах
 * (layout.md → «Interaction with loading.js»). Шапка и master-колонка ждут
 * только узкий select по шотам, миниатюры догружаются потоком.
 */
export const dynamic = "force-dynamic";

async function ChromeHeader({ episodeId }: { episodeId: string }) {
  const [shots, episodeNumber] = await Promise.all([
    getShotNav(episodeId),
    getEpisodeNumber(episodeId),
  ]);
  return <ShotChromeHeader episodeId={episodeId} episodeNumber={episodeNumber} shots={shots} />;
}

async function ChromeStrip({ episodeId }: { episodeId: string }) {
  return <ShotFilmStrip episodeId={episodeId} shots={await getStripShots(episodeId)} />;
}

async function ChromeMaster({ episodeId }: { episodeId: string }) {
  return <ShotMasterColumn episodeId={episodeId} shots={await getShotNav(episodeId)} />;
}

export default async function ShotCardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id: episodeId } = await params;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl lg:h-dvh lg:min-h-0 lg:max-w-none lg:overflow-hidden">
      <Suspense fallback={<SkHeader />}>
        <ChromeHeader episodeId={episodeId} />
      </Suspense>

      {/* кинолента — только на мобиле; на десктопе шоты в master-колонке (не дублируем) */}
      <div className="lg:hidden">
        <Suspense fallback={<SkFilmStrip />}>
          <ChromeStrip episodeId={episodeId} />
        </Suspense>
      </div>

      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[280px_1fr]">
        {/* master-колонка (spec §4, десктоп) */}
        <Suspense fallback={<SkMasterColumn />}>
          <ChromeMaster episodeId={episodeId} />
        </Suspense>
        {children}
      </div>
    </main>
  );
}
