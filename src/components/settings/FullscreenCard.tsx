"use client";

/**
 * Полный экран на телефоне. Браузерную полосу убирают два пути:
 * 1) PWA: «Добавить на главный экран» — приложение открывается standalone
 *    (манифест уже настроен). Минус quick-туннеля: адрес trycloudflare меняется
 *    при каждом запуске, значок придётся обновлять.
 * 2) Fullscreen API — работает в Android Chrome прямо из вкладки (до закрытия).
 *    iOS Safari для страниц его не поддерживает — там только путь №1.
 */
import { useMemo, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * Режим показа — состояние ВНЕШНЕЕ по отношению к React (matchMedia, Fullscreen
 * API), поэтому читаем его через useSyncExternalStore, а не setState в эффекте:
 * серверный снапшот пустой, значит SSR-разметка и первый клиентский рендер
 * совпадают, а реальные значения приезжают сразу после гидратации.
 * Снапшот — СТРОКА: useSyncExternalStore сравнивает по ссылке, и новый объект на
 * каждый вызов уводил бы рендер в бесконечный цикл.
 */
function subscribe(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function getSnapshot(): string {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return [
    standalone,
    Boolean(document.documentElement.requestFullscreen),
    Boolean(document.fullscreenElement),
  ].join("|");
}

const SERVER_SNAPSHOT = "";

export default function FullscreenCard() {
  const t = useT();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const state = useMemo(() => {
    if (!snapshot) return null; // ещё не гидратировались
    const [standalone, canFullscreen, isFullscreen] = snapshot.split("|");
    return {
      standalone: standalone === "true",
      canFullscreen: canFullscreen === "true",
      isFullscreen: isFullscreen === "true",
    };
  }, [snapshot]);

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
