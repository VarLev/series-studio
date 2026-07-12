/**
 * Крупная шапка раздела «Пульт» — одинаковая на Настройках и Затратах, чтобы
 * при переключении подвкладок она не «прыгала» (обе страницы одной высоты/стиля).
 */
export default function SettingsHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="px-4 pb-3 pt-6" style={{ paddingTop: "max(24px, env(safe-area-inset-top))" }}>
      <div className="eyebrow mb-1.5">Series Studio</div>
      <h1 className="chrome-text font-display text-[22px] font-bold uppercase leading-tight tracking-[0.06em]">
        {title}
      </h1>
      <p className="mt-1.5 text-[11px] leading-relaxed text-t400">{subtitle}</p>
    </div>
  );
}
