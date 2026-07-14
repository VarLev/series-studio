import StatusPill from "@/components/StatusPill";
import BackButton from "@/components/nav/BackButton";

export { StatusPill };
export { SHOT_STATUS, ENTITY_TYPE_LABEL } from "@/lib/statuses";

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
        loading="lazy"
        decoding="async"
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
        <BackButton
          fallbackHref={backHref}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-t100 hover:bg-ink-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
        </BackButton>
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
