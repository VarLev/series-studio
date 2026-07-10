import Link from "next/link";

export const SHOT_STATUS: Record<string, { label: string; color: string; bg: string; pulse?: boolean }> = {
  draft: { label: "Черновик", color: "var(--text-300)", bg: "rgba(148,140,166,.12)" },
  prompted: { label: "Промпт готов", color: "var(--violet-200)", bg: "rgba(139,95,176,.14)" },
  generating: { label: "Генерация", color: "var(--warning)", bg: "rgba(192,138,62,.14)", pulse: true },
  review: { label: "Ревью", color: "var(--magenta-400)", bg: "rgba(178,95,208,.12)" },
  approved: { label: "Утверждён", color: "var(--success)", bg: "rgba(79,143,125,.14)" },
  failed: { label: "Ошибка", color: "var(--danger)", bg: "rgba(194,71,106,.14)" },
};

export function StatusPill({ status }: { status: string }) {
  const s = SHOT_STATUS[status] ?? SHOT_STATUS.draft;
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.16em] ${s.pulse ? "pulse-amber" : ""}`}
      style={{ color: s.color, background: s.bg, borderColor: s.color + "44" }}
    >
      {s.label}
    </span>
  );
}

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  character: "Персонаж",
  location: "Локация",
  prop: "Реквизит",
  style: "Стиль",
};

export function EntityAvatar({
  name,
  imageUrl,
  size = 24,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-[var(--border-default)] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-ink-500 text-[10px] font-semibold text-violet-200"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ScreenHeader({
  backHref,
  eyebrow,
  title,
  right,
}: {
  backHref?: string;
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2"
      style={{
        background: "linear-gradient(180deg, rgba(15,12,22,.95), rgba(10,8,16,.85))",
        backdropFilter: "blur(10px)",
        paddingTop: "max(8px, env(safe-area-inset-top))",
      }}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label="Назад"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-t100 hover:bg-ink-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <div className="eyebrow">{eyebrow}</div>
        <div className="truncate text-[14px] font-semibold leading-tight text-t100">{title}</div>
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-default)] p-4 text-[12px] leading-relaxed text-t400">
      <span className="text-violet-600">✦</span>&nbsp; {children}
    </div>
  );
}

export function SectionLabel({
  children,
  hint,
  right,
}: {
  children: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="section-label">{children}</div>
      {hint && <span className="text-[9.5px] text-t400">{hint}</span>}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}
