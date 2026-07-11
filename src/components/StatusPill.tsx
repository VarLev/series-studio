"use client";

import { useT } from "@/components/I18nProvider";
import { SHOT_STATUS } from "@/lib/statuses";

export default function StatusPill({ status }: { status: string }) {
  const t = useT();
  const s = SHOT_STATUS[status] ?? SHOT_STATUS.draft;
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1.5 text-[9.5px] font-semibold uppercase leading-none tracking-[0.16em] ${s.pulse ? "pulse-amber" : ""}`}
      style={{ color: s.color, background: s.bg, borderColor: s.color + "44" }}
    >
      {t(s.ru, s.en)}
    </span>
  );
}
