import { requireAuth } from "@/lib/auth";
import { ScreenHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  await requireAuth();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/episodes" eyebrow="Higgsfield · все серии" title="Очередь задач" />
      <div className="flex flex-col gap-3 p-4">
        <div className="section-label">Активные</div>
        <EmptyState>Сейчас ничего не генерируется.</EmptyState>
        <div className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-[12px] leading-relaxed text-t400">
          Очередь Higgsfield заработает на Этапе 2 — вместе с генерацией внутри приложения.
          Пока результаты добавляются через «Копи-пак» на карточке шота.
        </div>
      </div>
    </main>
  );
}
