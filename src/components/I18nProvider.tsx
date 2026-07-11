"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type T } from "@/lib/i18n";

const Ctx = createContext<T>((ru) => ru);

export function I18nProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  const t = useMemo(() => makeT(lang), [lang]);
  return <Ctx.Provider value={t}>{children}</Ctx.Provider>;
}

/** t() для клиентских компонентов: t("Русский", "English"). */
export function useT(): T {
  return useContext(Ctx);
}
