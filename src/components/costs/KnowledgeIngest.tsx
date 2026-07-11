"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ingestKnowledge } from "@/lib/actions/settings";
import { useT } from "@/components/I18nProvider";

export default function KnowledgeIngest() {
  const router = useRouter();
  const t = useT();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() =>
          startTransition(async () => {
            const res = await ingestKnowledge();
            setMessage(res.message);
            router.refresh();
          })
        }
        disabled={pending}
        className="min-h-11 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-200 hover:border-[var(--border-strong)] disabled:opacity-50"
      >
        {pending ? t("Читаю /knowledge…", "Reading /knowledge…") : t("Обновить базу знаний", "Refresh knowledge base")}
      </button>
      {message && <div className="text-[11px] text-t300">{message}</div>}
    </div>
  );
}
