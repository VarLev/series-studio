"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Горячие клавиши карточки шота (spec §5): J/K — шоты, G — генерация, P — промпт, Esc — назад.
 *  e.code — работает и в русской раскладке. */
export default function ShotHotkeys({
  prevHref,
  nextHref,
  editorHref,
  backHref,
}: {
  prevHref: string | null;
  nextHref: string | null;
  editorHref: string;
  backHref: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.code) {
        case "KeyJ":
          if (nextHref) router.push(nextHref);
          break;
        case "KeyK":
          if (prevHref) router.push(prevHref);
          break;
        case "KeyG":
          window.dispatchEvent(new CustomEvent("ss:open-generate"));
          break;
        case "KeyP":
          router.push(editorHref);
          break;
        case "Escape":
          router.push(backHref);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref, editorHref, backHref]);
  return null;
}
