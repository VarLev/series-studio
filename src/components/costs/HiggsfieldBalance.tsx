"use client";

/** Текущий баланс кредитов подписки Higgsfield (через MCP). Автозагрузка + обновление. */
import { useEffect, useState } from "react";
import { hfBalance } from "@/lib/actions/settingsPage";
import { useT } from "@/components/I18nProvider";

type State =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "ok"; credits: number | null; plan: string; usd: number | null }
  | { kind: "err"; msg: string };

export default function HiggsfieldBalance() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  async function fetchBalance() {
    const res = await hfBalance();
    if (res.ok) setState({ kind: "ok", credits: res.credits, plan: res.plan, usd: res.usd });
    else if (res.error === "not_connected") setState({ kind: "off" });
    else setState({ kind: "err", msg: res.error });
  }

  function refresh() {
    setState({ kind: "loading" });
    void fetchBalance();
  }

  useEffect(() => {
    // загрузка баланса при открытии экрана: setState только после await (сеть)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBalance();
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
      <div className="flex items-center gap-2">
        <span className="section-label flex-1">{t("Кредиты Higgsfield (подписка)", "Higgsfield credits (plan)")}</span>
        {state.kind !== "loading" && state.kind !== "off" && (
          <button
            onClick={refresh}
            className="font-mono text-[10px] text-t400 hover:text-violet-200"
          >
            ↻ {t("обновить", "refresh")}
          </button>
        )}
      </div>
      {state.kind === "loading" && (
        <div className="mt-1 font-mono text-[12px] text-t400">{t("загрузка…", "loading…")}</div>
      )}
      {state.kind === "off" && (
        <div className="mt-1 text-[11px] leading-relaxed text-t400">
          {t(
            "Higgsfield не подключён — подключите аккаунт в «Настройках», чтобы видеть баланс.",
            "Higgsfield not connected — connect your account in Settings to see the balance.",
          )}
        </div>
      )}
      {state.kind === "ok" && (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold text-t100">
            {state.credits ?? "?"}
          </span>
          <span className="text-[11px] text-t400">
            {t("кредитов", "credits")}
            {state.plan ? ` · ${state.plan}` : ""}
            {state.usd != null ? ` · ~$${state.usd.toFixed(2)}` : ""}
          </span>
        </div>
      )}
      {state.kind === "err" && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-danger">
          <span>{t("не удалось получить баланс", "couldn't fetch balance")}</span>
          <button onClick={refresh} className="font-mono text-[10px] text-t400 hover:text-violet-200">
            ↻
          </button>
        </div>
      )}
    </div>
  );
}
