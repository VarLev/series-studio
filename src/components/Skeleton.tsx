/**
 * Примитивы скелетонов для loading.tsx (мгновенный отклик навигации):
 * без них App Router не показывает ничего, пока страница рендерится на
 * сервере и едет через туннель — тап выглядит «непринятым».
 */

export function Sk({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} />;
}

/** Контейнер, повторяющий <main> всех экранов приложения. */
export function SkPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      {children}
    </main>
  );
}

/** Шапка вложенного экрана — как ScreenHeader (кнопка «назад» + заголовок). */
export function SkHeader() {
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2"
      style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}
    >
      <Sk className="h-10 w-10 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Sk className="h-2.5 w-20" />
        <Sk className="h-3.5 w-40" />
      </div>
    </div>
  );
}

/** Шапка верхнего экрана — eyebrow + крупный заголовок (как на /episodes). */
export function SkTitle() {
  return (
    <div
      className="px-4 pb-3 pt-6"
      style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}
    >
      <Sk className="mb-2 h-2.5 w-24" />
      <Sk className="h-6 w-52" />
    </div>
  );
}

/** Вертикальный список карточек (серии, шоты, сущности, очередь). */
export function SkCards({ count = 5, height = 76 }: { count?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-4">
      {Array.from({ length: count }).map((_, i) => (
        <Sk key={i} className="w-full rounded-xl" style={{ height }} />
      ))}
    </div>
  );
}

/** Сетка миниатюр (галерея, референсы). */
export function SkGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 px-4 py-4">
      {Array.from({ length: count }).map((_, i) => (
        <Sk key={i} className="aspect-square w-full rounded-lg" />
      ))}
    </div>
  );
}
