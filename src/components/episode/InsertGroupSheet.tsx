"use client";

/**
 * Вставная группа шотов: «+» на разделителе сцены → шторка с запросом («что
 * должно быть в новых шотах»), выбором текстовой модели и оценкой стоимости.
 * Модель получает контекст сцены и создаёт 1..N групп внутри неё (is_insert).
 * Долгий LLM-вызов — с поллинг-самовосстановлением через туннель (паттерн
 * PromptBlock: не полагаемся на возврат экшена, следим за числом групп).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import { insertShotGroups, countEpisodeShots } from "@/lib/actions/shots";
import { LLM_MODELS } from "@/lib/llm/models";
import { estTextUsd, fmtUsd } from "@/lib/pricing";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export default function InsertGroupSheet({
  episodeId,
  anchor,
  onClose,
  defaultModel,
  baselineCount,
}: {
  episodeId: string;
  /** сцена, в которую добавляем: шот-начало сцены + её номер; null — закрыто */
  anchor: { shotId: string; scene: number } | null;
  onClose: () => void;
  /** модель по умолчанию — та же, что выбрана для раскадровки */
  defaultModel: string;
  /** текущее число групп эпизода — ориентир для поллинга результата */
  baselineCount: number;
}) {
  const t = useT();
  const en = t("ru", "en") === "en"; // язык подписей моделей (как в SynopsisEditor)
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const timers = useRef<{
    tick?: ReturnType<typeof setInterval>;
    poll?: ReturnType<typeof setInterval>;
    refresh?: ReturnType<typeof setInterval>;
  }>({});
  const doneRef = useRef(false);

  function cleanupTimers() {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.refresh) clearInterval(timers.current.refresh);
    timers.current = {};
  }
  useEffect(() => cleanupTimers, []);

  const estUsd = fmtUsd(estTextUsd(model, 2500, 4000));

  function finishOk() {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    setBusy(false);
    setRequest("");
    toast(t("Вставная группа создана — она в конце сцены", "Insert group created — at the end of the scene"));
    onClose();
    // через туннель одиночный refresh может потеряться — повторяем несколько раз
    router.refresh();
    let tries = 0;
    const iv = setInterval(() => {
      router.refresh();
      if (++tries >= 4) clearInterval(iv);
    }, 1000);
    timers.current.refresh = iv;
  }
  function finishErr(msg: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanupTimers();
    setBusy(false);
    setError(msg);
  }

  async function onCreate() {
    if (!anchor || !request.trim()) return;
    setError("");
    setElapsed(0);
    setBusy(true);
    doneRef.current = false;
    // свежий ориентир с сервера: пропсовый baseline мог устареть, если предыдущий
    // refresh не доехал — тогда поллинг принял бы старый результат за новый
    const baseline = await countEpisodeShots(episodeId).catch(() => baselineCount);
    const startedAt = Date.now();
    timers.current.tick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (sec >= 240) {
        finishErr(
          t(
            "Ответа нет дольше 4 минут. Группа могла не создаться — обновите страницу или попробуйте ещё раз.",
            "No response for over 4 minutes. The group may not have been created — reload or try again.",
          ),
        );
      }
    }, 1000);
    // самовосстановление: если ответ экшена потеряется в туннеле, поллинг числа
    // групп заметит появившийся результат и завершит ожидание сам
    timers.current.poll = setInterval(async () => {
      try {
        const n = await countEpisodeShots(episodeId);
        if (n > baseline) finishOk();
      } catch {
        // сеть моргнула — попробуем в следующий тик
      }
    }, 4000);
    try {
      const res = await insertShotGroups(anchor.shotId, request, model);
      if (res.ok) finishOk();
      else finishErr(res.error);
    } catch {
      // обрыв соединения: результат подхватит поллинг выше
    }
  }

  return (
    <Sheet
      open={Boolean(anchor)}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={`${t("Новые шоты в сцене", "New shots in scene")} ${anchor?.scene ?? ""}`}
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-[11px] leading-relaxed text-t400">
          {t(
            "Опишите, что должно происходить в новых шотах. Модель получит контекст этой сцены и соберёт вставную группу (или несколько) в её конце. Вставка живёт отдельно: свои локация, время/погода и референсы, своя шкала времени — существующие шоты и сквозной таймкод не меняются.",
            "Describe what should happen in the new shots. The model gets this scene's context and builds an insert group (or several) at its end. An insert lives on its own: its own location, time/weather and references, its own clock — existing shots and the episode timecode stay untouched.",
          )}
        </p>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={4}
          placeholder={t(
            "Напр.: параллельно Крейг наблюдает за ними с другой стороны улицы и звонит кому-то…",
            "E.g.: meanwhile Craig watches them from across the street and calls someone…",
          )}
          className="w-full resize-y rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 py-2 text-[12px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
            {t("Модель", "Model")}
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="min-h-9 w-full min-w-0 max-w-full truncate rounded-md border border-[var(--border-default)] bg-ink-600 px-2 font-mono text-[11px] text-t100 outline-none"
          >
            {LLM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {en ? m.hintEn : m.hint}
              </option>
            ))}
            {!LLM_MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </div>
        {error && <div className="text-[11px] text-danger">{error}</div>}
        <button
          onClick={onCreate}
          disabled={busy || !request.trim()}
          className="min-h-11 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {busy
            ? t(`Модель собирает шоты… ${elapsed}с`, `The model is building shots… ${elapsed}s`)
            : t(`Создать · ~${estUsd}`, `Create · ~${estUsd}`)}
        </button>
      </div>
    </Sheet>
  );
}
