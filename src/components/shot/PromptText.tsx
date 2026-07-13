"use client";

import { useEffect, useState } from "react";

/**
 * Моно-текст промпта с подсветкой element_name/якорей как токенов-чипов.
 * Тап по токену раскрывает миниатюру его референса (если она передана в images);
 * тап в любое другое место закрывает её.
 */
export default function PromptText({
  text,
  tokens,
  images = {},
}: {
  text: string;
  tokens: string[];
  /** токен → url миниатюры (персонаж/референс/стартовый кадр/композиция) */
  images?: Record<string, string | null>;
}) {
  const [preview, setPreview] = useState<{ url: string; label: string; x: number; y: number } | null>(
    null,
  );

  // закрытие по тапу в любом другом месте (открывающий клик идёт после pointerdown,
  // поэтому слушатель, повешенный этим же кликом, его не поймает)
  useEffect(() => {
    if (!preview) return;
    const close = () => setPreview(null);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [preview]);

  const escaped = tokens
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // все токены пустые → regex «()» посимвольно раздробил бы текст
  if (!escaped.length) return <>{text}</>;
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  const lower = new Set(tokens.map((t) => t.toLowerCase()));
  const imgByToken = new Map(
    Object.entries(images)
      .filter((e): e is [string, string] => Boolean(e[1]))
      .map(([k, u]) => [k.toLowerCase(), u]),
  );

  function onTokenClick(e: React.MouseEvent<HTMLSpanElement>, token: string) {
    const url = imgByToken.get(token.toLowerCase());
    if (!url) return;
    e.stopPropagation(); // не сворачивать блок промпта (клик по тексту = expand)
    const r = e.currentTarget.getBoundingClientRect();
    setPreview((prev) =>
      prev?.url === url ? null : { url, label: token, x: r.left + r.width / 2, y: r.top },
    );
  }

  return (
    <>
      {parts.map((part, i) =>
        lower.has(part.toLowerCase()) ? (
          <span
            key={i}
            className="prompt-token"
            style={imgByToken.has(part.toLowerCase()) ? { cursor: "pointer" } : undefined}
            onClick={(e) => onTokenClick(e, part)}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}

      {/* миниатюра референса токена */}
      {preview && (
        <span
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[80] block overflow-hidden rounded-lg border border-[var(--violet-400)] bg-ink-800 shadow-xl"
          style={{
            left: Math.min(Math.max(preview.x, 90), typeof window !== "undefined" ? window.innerWidth - 90 : preview.x),
            top: preview.y,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={preview.label} className="block max-h-56 w-auto max-w-[170px] object-contain" />
          <span className="block truncate px-2 py-1 text-center font-mono text-[9px] text-violet-200">
            {preview.label}
          </span>
        </span>
      )}
    </>
  );
}
