"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/Sheet";
import UploadButton from "@/components/UploadButton";
import { useT } from "@/components/I18nProvider";

export interface CopyPackRef {
  url: string;
  name: string;
}

/**
 * M6 Копи-пак: (1) промпт копируется в буфер при открытии, (2) референсы шота
 * со скачиванием/шарингом, (3) ссылка на kling.ai, (4) зона загрузки результата.
 */
export default function CopyPackSheet({
  open,
  onClose,
  shotId,
  promptText,
  promptVersion,
  promptId,
  refs,
}: {
  open: boolean;
  onClose: () => void;
  shotId: string;
  promptText: string;
  promptVersion: number;
  promptId: string;
  refs: CopyPackRef[];
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && promptText) {
      navigator.clipboard
        .writeText(promptText)
        .then(() => setCopied(true))
        .catch(() => setCopied(false));
    }
  }, [open, promptText]);

  async function copyAgain() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function shareRef(ref: CopyPackRef) {
    try {
      const res = await fetch(ref.url);
      const blob = await res.blob();
      const file = new File([blob], `${ref.name || "reference"}.jpg`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch {}
    // fallback: обычное скачивание
    const a = document.createElement("a");
    a.href = ref.url;
    a.download = ref.name || "reference";
    a.click();
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Копи-пак для Kling web", "Copy pack for Kling web")}>
      <div
        className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
        style={{
          background: copied ? "rgba(79,143,125,.08)" : "rgba(194,71,106,.08)",
          borderColor: copied ? "rgba(79,143,125,.35)" : "rgba(194,71,106,.35)",
        }}
      >
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-ink-800"
          style={{ background: copied ? "var(--success)" : "var(--danger)" }}
        >
          {copied ? "✓" : "!"}
        </span>
        <span className="flex-1 text-[12.5px] font-medium text-t100">
          {copied
            ? t(`1 · Промпт v${promptVersion} скопирован в буфер`, `1 · Prompt v${promptVersion} copied to clipboard`)
            : t("Промпт не скопирован", "Prompt not copied")}
        </span>
        <button
          onClick={copyAgain}
          className="rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-[10px] font-semibold text-t200 hover:bg-ink-500"
        >
          {t("Ещё раз", "Again")}
        </button>
      </div>

      <div className="section-label mb-2 mt-4">
        {t("2 · Референсы — скачайте для kling.ai", "2 · References — download for kling.ai")}
      </div>
      {refs.length ? (
        <div className="grid grid-cols-4 gap-2">
          {refs.map((r, i) => (
            <button
              key={i}
              onClick={() => shareRef(r)}
              className="relative aspect-[9/16] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600 hover:border-[var(--border-strong)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(6,5,9,.9)] px-1.5 pb-1 pt-3 text-left text-[8.5px] font-semibold text-t100">
                {r.name}
              </span>
              <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-[rgba(6,5,9,.65)] text-[10px] text-white">
                ↓
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[11.5px] text-t400">
          {t(
            "У шота нет референсов — прикрепите их на карточке или загрузите в библию.",
            "The shot has no references — attach them on the card or upload to the bible.",
          )}
        </div>
      )}

      <a
        href="https://kling.ai"
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex min-h-[46px] items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200 hover:border-violet-400 hover:text-violet-100"
      >
        {t("3 · Открыть kling.ai ↗", "3 · Open kling.ai ↗")}
      </a>

      <div className="mt-4">
        <UploadButton
          kind="result"
          shotId={shotId}
          promptId={promptId}
          label={t("Загрузить результат сюда", "Upload the result here")}
        />
        <div className="mt-1.5 text-center text-[10px] text-t400">
          {t(`привяжется к промпту v${promptVersion} · source: kling-web`, `links to prompt v${promptVersion} · source: kling-web`)}
        </div>
      </div>
    </Sheet>
  );
}
