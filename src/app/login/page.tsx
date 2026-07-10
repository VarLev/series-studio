"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions/settings";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <div className="eyebrow mb-2">Series Studio</div>
        <h1 className="chrome-text font-display text-[28px] font-bold uppercase tracking-[0.07em]">
          Пульт
        </h1>
      </div>
      <form action={action} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Пароль"
          autoFocus
          className="min-h-12 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-4 text-[14px] text-t100 outline-none focus:border-[var(--border-strong)]"
        />
        {state?.error && <div className="text-[12px] text-danger">{state.error}</div>}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-lg bg-violet-500 text-[12px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-50"
          style={{ boxShadow: "var(--glow-violet-sm)" }}
        >
          {pending ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
