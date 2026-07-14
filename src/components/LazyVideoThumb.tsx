"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Миниатюра-видео с ленивой загрузкой: src проставляется ТОЛЬКО когда элемент
 * реально попал в вьюпорт (IntersectionObserver). Скрытые элементы (display:none,
 * напр. кинолента на десктопе под lg:hidden) с вьюпортом не пересекаются и НЕ
 * грузят видео. Раньше preload="metadata" тянул moov+кадр каждого mp4 (по
 * несколько range-запросов), и десятки миниатюр насыщали пул соединений браузера
 * на ~5 сек при каждом открытии страницы (замер: 50 видео-запросов → 4).
 */
export default function LazyVideoThumb({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (show) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  return (
    <video
      ref={ref}
      // #t=0.1 — браузер показывает стоп-кадр вместо пустого плеера
      src={show ? `${src}#t=0.1` : undefined}
      muted
      playsInline
      preload="metadata"
      className={className}
    />
  );
}
