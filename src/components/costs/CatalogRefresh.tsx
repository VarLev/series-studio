"use client";

import { useState, useTransition } from "react";
import { refreshModelCatalog } from "@/lib/actions/generate";
import { useT } from "@/components/I18nProvider";

export default function CatalogRefresh() {
  const t = useT();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() =>
          startTransition(async () => {
            const res = await refreshModelCatalog();
            setMessage(res.message);
          })
        }
        disabled={pending}
        className="min-h-11 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:border-[var(--border-strong)] disabled:opacity-50"
      >
        {pending ? t("Запрашиваю каталог…", "Fetching catalog…") : t("Обновить каталог моделей", "Refresh model catalog")}
      </button>
      {message && <div className="text-[11px] text-t300">{message}</div>}
    </div>
  );
}
