"use client";

/**
 * Полный экран на телефоне. Браузерную полосу убирают два пути:
 * 1) PWA: «Добавить на главный экран» — приложение открывается standalone
 *    (манифест уже настроен). Минус quick-туннеля: адрес trycloudflare меняется
 *    при каждом запуске, значок придётся обновлять.
 * 2) Fullscreen API — работает в Android Chrome прямо из вкладки (до закрытия).
 *    iOS Safari для страниц его не поддерживает — там только путь №1.
 */
import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";

export default function FullscreenCard() {
  const t = useT();
  // всё определяем после маунта, чтобы SSR-разметка совпала с клиентской
  const [state, setState] = useState<{
    standalone: boolean;
    canFullscreen: boolean;
    isFullscreen: boolean;
  } | null>(null);

  useEffect(() => {
    const compute = () => ({
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        (navigator as { standalone?: boolean }).standalone === true,
      canFullscreen: Boolean(document.documentElement.requestFullscreen),
      isFullscreen: Boolean(document.fullscreenElement),
    });
    setState(compute());
    const onChange = () => setState(compute());
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // уже без браузерной полосы (PWA/fullscreen) — карточка не нужна
  if (!state || state.standalone) return null;

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
      <span className="section-label">{t("Полный экран на телефоне", "Fullscreen on phone")}</span>
      {state.canFullscreen && (
        <button
          onClick={toggle}
          className="min-h-11 w-full rounded-lg border border-[var(--border-default)] text-[11.5px] font-semibold text-violet-200 hover:border-[var(--border-strong)] hover:bg-ink-600"
        >
          {state.isFullscreen
            ? t("⤢ Выйти из полного экрана", "⤢ Exit fullscreen")
            : t("⤢ На весь экран (до закрытия вкладки)", "⤢ Go fullscreen (until the tab closes)")}
        </button>
      )}
      <p className="text-[11px] leading-relaxed text-t400">
        {t(
          "Навсегда убрать адресную строку: добавьте приложение на главный экран — Android Chrome: меню ⋮ → «Добавить на гл. экран»; iPhone Safari: «Поделиться» → «На экран „Домой“». Значок открывается без браузера.",
          "To hide the address bar permanently, add the app to your home screen — Android Chrome: ⋮ menu → “Add to Home screen”; iPhone Safari: “Share” → “Add to Home Screen”. The icon opens without browser chrome.",
        )}
      </p>
      <p className="text-[11px] leading-relaxed text-t400">
        {t(
          "⚠ Адрес trycloudflare меняется при каждом запуске туннеля — значок перестанет открываться. Для постоянного значка нужен именованный туннель Cloudflare со своим доменом.",
          "⚠ The trycloudflare address changes on every tunnel start, breaking the icon. For a permanent icon use a named Cloudflare tunnel with your own domain.",
        )}
      </p>
    </div>
  );
}
