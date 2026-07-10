"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Загрузка референса/результата: с телефона открывает камеру или галерею в 1 тап. */
export default function UploadButton({
  kind,
  entityId,
  shotId,
  episodeId,
  promptId,
  role,
  label,
  className,
}: {
  kind: "reference" | "result";
  entityId?: string;
  shotId?: string;
  episodeId?: string;
  promptId?: string;
  role?: "start_frame" | "composition";
  label: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);
        form.set("kind", kind);
        if (entityId) form.set("entityId", entityId);
        if (shotId) form.set("shotId", shotId);
        if (episodeId) form.set("episodeId", episodeId);
        if (promptId) form.set("promptId", promptId);
        if (role) form.set("role", role);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Ошибка загрузки (${res.status})`);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={kind === "result" ? "video/*,image/*" : "image/*"}
        multiple={kind === "reference"}
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={
          className ??
          "flex min-h-12 w-full flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-[var(--border-default)] px-3 py-4 text-[12px] text-t200 hover:border-[var(--border-strong)] disabled:opacity-50"
        }
      >
        {busy ? "Загрузка…" : label}
      </button>
      {error && <div className="mt-1 text-[11px] text-danger">{error}</div>}
    </>
  );
}
