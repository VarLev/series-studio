"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * Мобильная обёртка блока «Промпт»: круглый FAB справа внизу открывает правый
 * слайдер на 95% ширины (по мотивам SideDrawer, но на client-state — без
 * intercepting-роута). FAB стоит по общему FAB-контракту НАД «Генерировать»
 * (ActionBar): 56px, right 16px, bottom = таб-бар 58px + safe-area + 84px.
 *
 * ВАЖНО: PromptBlock внутри всегда смонтирован — у него самовосстановление
 * генерации на таймерах и маркерах pgen:* в localStorage; слайдер прячем через
 * CSS (translate/visibility), а не условным рендером, чтобы не рвать таймеры.
 * В открытом состоянии transform снят (transform-none): transform у предка
 * делал бы fixed-шторки внутри PromptBlock (история, приёмы) относительными
 * к слайдеру, а не к вьюпорту.
 * Десктоп (lg): обёртка нейтрализуется классами — блок рендерится инлайн,
 * как раньше; FAB, бэкдроп и шапка слайдера скрыты.
 */
export default function PromptDrawer({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Esc — в capture-фазе со stopPropagation, иначе Escape долетит до
    // ShotHotkeys и уведёт со страницы шота вместо закрытия слайдера
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    // блокируем скролл страницы под слайдером (как SideDrawer)
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* FAB (мобайл) — НАД кнопкой «Генерировать» по FAB-контракту */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("Промпт", "Prompt")}
        title={t("Открыть блок промпта", "Open the prompt block")}
        className="fixed z-30 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-default)] bg-ink-600 text-[20px] text-t100 hover:bg-ink-500 lg:hidden"
        style={{
          right: "16px",
          bottom: "calc(58px + env(safe-area-inset-bottom) + 84px)",
          backdropFilter: "blur(10px)",
        }}
      >
        ✎
      </button>

      {/* мобайл — оверлей с правым слайдером; десктоп — обычный блок в потоке */}
      <div
        className={`fixed inset-0 z-50 transition-[visibility] duration-200 ${
          open ? "visible" : "invisible"
        } lg:static lg:z-auto lg:visible lg:transition-none`}
      >
        {/* затемнение — тап закрывает */}
        <div
          className={`absolute inset-0 bg-[rgba(3,2,5,.6)] transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          } lg:hidden`}
          style={{ backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 right-0 flex w-[95%] flex-col border-l border-[var(--border-default)] bg-ink-800 shadow-2xl transition-transform duration-200 ease-out ${
            open ? "transform-none" : "translate-x-full"
          } lg:static lg:w-auto lg:transform-none lg:border-l-0 lg:bg-transparent lg:shadow-none lg:transition-none`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3 lg:hidden">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-t100">
              {t("Промпт", "Prompt")}
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label={t("Закрыть", "Close")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[16px] text-t400 hover:bg-ink-600 hover:text-t100"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(24px,env(safe-area-inset-bottom))] lg:flex-none lg:overflow-visible lg:p-0">
            {children}
          </div>
        </aside>
      </div>
    </>
  );
}
