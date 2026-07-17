"use client";

/**
 * Редактор одного шаблона промпта — спойлер с текстом, сохранением и сбросом к
 * стандартному. Живёт на вкладке «База знаний» рядом с методичками и приёмами:
 * шаблон — такая же инструкция промпт-фабрике, просто редактируемая целиком.
 */
import { useState, useTransition } from "react";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { saveTemplate, resetTemplate } from "@/lib/actions/settingsPage";
import { useT } from "@/components/I18nProvider";

export type TemplateKeySetting = "tpl_breakdown" | "tpl_storyboard" | "tpl_video" | "tpl_video_kling";

export default function TemplateEditor({
  settingKey,
  title,
  hint,
  initial,
}: {
  settingKey: TemplateKeySetting;
  title: string;
  hint: string;
  initial: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dirty = value !== initial;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-ink-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-t100">{title}</span>
          <span className="mt-0.5 block text-[10.5px] leading-relaxed text-t400">{hint}</span>
        </span>
        <span className="text-t400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] p-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                startTransition(async () => {
                  const res = await saveTemplate(settingKey, value);
                  toast(
                    res.ok
                      ? t("Шаблон сохранён", "Template saved")
                      : ("error" in res && res.error) || t("Ошибка", "Error"),
                  );
                })
              }
              disabled={pending || !dirty}
              className="min-h-10 flex-1 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.1em] text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {pending
                ? t("Сохранение…", "Saving…")
                : dirty
                  ? t("Сохранить шаблон", "Save template")
                  : t("Сохранено", "Saved")}
            </button>
            <ConfirmButton
              action={async () => {
                // стандартный текст берём из ответа экшена: initial — это старый
                // кастомный шаблон из замыкания, и подстановка его же выглядела
                // как «сброс ничего не сделал» до перезагрузки страницы
                setValue(await resetTemplate(settingKey));
              }}
              label={t("Сбросить", "Reset")}
              confirmLabel={t("Вернуть стандартный?", "Restore the default?")}
              doneToast={t("Шаблон сброшен к стандартному", "Template reset to default")}
              className="min-h-10 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold text-t300 hover:bg-ink-500 disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </div>
  );
}
