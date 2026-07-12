"use client";

/**
 * Черновик новой серии (/episodes/new). Запись в БД появляется ТОЛЬКО при
 * первом непустом вводе (замечание заказчика: кнопка не должна плодить пустые
 * эпизоды). До этого текст живёт в localStorage; после создания черновик
 * переезжает под ключ реального эпизода и экран заменяется на полноценный
 * редактор (SynopsisEditor его подхватит).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createEpisodeFromDraft } from "@/lib/actions/episodes";
import { SectionLabel } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

const DRAFT_KEY = "ss-draft:new";

type Draft = { title: string; logline: string; synopsis: string };

export default function NewEpisodeEditor() {
  const router = useRouter();
  const t = useT();
  const [draft, setDraft] = useState<Draft>({ title: "", logline: "", synopsis: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false); // защита от двойного создания
  const latest = useRef(draft); // самый свежий текст на момент ответа сервера
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // восстановить недописанный черновик (обрыв сети / случайный уход со страницы)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        const restored = {
          title: d.title ?? "",
          logline: d.logline ?? "",
          synopsis: d.synopsis ?? "",
        };
        latest.current = restored;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft(restored);
      }
    } catch {}
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function hasText(d: Draft): boolean {
    return Boolean(d.title.trim() || d.logline.trim() || d.synopsis.trim());
  }

  function onChange(patch: Partial<Draft>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {}
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(create, 800);
  }

  async function create() {
    if (started.current || !hasText(latest.current)) return;
    started.current = true;
    setCreating(true);
    setError("");
    try {
      const id = await createEpisodeFromDraft({
        title: latest.current.title,
        logline: latest.current.logline,
        synopsisMd: latest.current.synopsis,
      });
      // всё, что успели дописать за время запроса, доедет через драфт
      // SynopsisEditor (он восстанавливает черновик поверх серверных данных)
      try {
        localStorage.setItem(
          `ss-draft:${id}`,
          JSON.stringify({
            title: latest.current.title,
            logline: latest.current.logline,
            synopsis: latest.current.synopsis,
          }),
        );
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      router.replace(`/episodes/${id}`);
    } catch (e) {
      started.current = false;
      setCreating(false);
      setError(e instanceof Error ? e.message : t("Не удалось создать серию", "Failed to create the episode"));
    }
  }

  const statusLabel = creating
    ? t("создание серии…", "creating episode…")
    : hasText(draft)
      ? t("сохранение…", "saving…")
      : t("черновик — серия появится с первым текстом", "draft — the episode appears with the first text");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <input
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t("Название серии", "Episode title")}
          autoFocus
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
        <input
          value={draft.logline}
          onChange={(e) => onChange({ logline: e.target.value })}
          placeholder={t(
            "Логлайн — одна фраза о серии",
            "Logline — one sentence about the episode",
          )}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <SectionLabel right={<span className="font-mono text-[10px] text-t400">{statusLabel}</span>}>
        {t("Литературный сюжет", "Literary story")}
      </SectionLabel>

      <textarea
        value={draft.synopsis}
        onChange={(e) => onChange({ synopsis: e.target.value })}
        spellCheck={false}
        placeholder={t(
          "Вставьте сюда готовый литературный сюжет серии — Claude разобьёт его на группы шотов по шаблону из настроек.",
          "Paste the finished literary story of the episode here — Claude will break it into shot groups per your Settings template.",
        )}
        className="min-h-[40dvh] flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 font-body text-[15px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
      />

      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
