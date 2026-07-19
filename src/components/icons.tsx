/**
 * Небольшой набор линейных иконок (Lucide-стиль, stroke=currentColor) — чистые
 * presentational-компоненты без хуков, годятся и для server-, и для client-частей.
 * Наследуют цвет и масштабируются размером в px.
 */

type IconProps = { size?: number; className?: string };

/** Референсы серии — рамка с «солнцем» и горами (классическая image-иконка). */
export function ImageIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-4.6-4.6a2 2 0 0 0-2.8 0L4 20" />
    </svg>
  );
}

/** Галерея видео — киноплёнка с перфорацией. */
export function FilmIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="3" width="19" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5M7 12h10" />
    </svg>
  );
}
