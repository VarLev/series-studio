"use client";

/**
 * Общий стейт трека промпта для карточки шота: активная модель (Seedance/Kling)
 * и «открытая» версия каждого трека. Нужен, чтобы:
 *  - GroupShotsEditor показывал иконку активной модели на каждом шоте и генерил
 *    промпт одного шота для неё;
 *  - PromptBlock переключал открытую версию;
 *  - ActionBar/GenerateSheet отправлял на генерацию именно ОТКРЫТУЮ версию.
 */
import { createContext, useContext, useState } from "react";
import type { PromptFamily } from "@/lib/llm/models";

interface Ctx {
  family: PromptFamily;
  setFamily: (f: PromptFamily) => void;
  /** id открытой версии по трекам; undefined = последняя версия трека */
  openByFamily: Partial<Record<PromptFamily, string>>;
  /** id === undefined → снова «последняя версия» */
  setOpen: (f: PromptFamily, id: string | undefined) => void;
}

const PromptTrackCtx = createContext<Ctx | null>(null);

export function usePromptTrack(): Ctx {
  const c = useContext(PromptTrackCtx);
  if (!c) throw new Error("usePromptTrack must be used inside <PromptTrackProvider>");
  return c;
}

export default function PromptTrackProvider({
  initialFamily,
  children,
}: {
  initialFamily: PromptFamily;
  children: React.ReactNode;
}) {
  const [family, setFamily] = useState<PromptFamily>(initialFamily);
  const [openByFamily, setOpenByFamily] = useState<Partial<Record<PromptFamily, string>>>({});
  const setOpen = (f: PromptFamily, id: string | undefined) =>
    setOpenByFamily((prev) => ({ ...prev, [f]: id }));
  return (
    <PromptTrackCtx.Provider value={{ family, setFamily, openByFamily, setOpen }}>
      {children}
    </PromptTrackCtx.Provider>
  );
}
