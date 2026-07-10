"use client";

import { useEffect, useState } from "react";

/** Тосты (spec §5): подтверждение каждого действия. toast("…") из любого клиентского кода. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("ss:toast", { detail: message }));
}

interface Item {
  id: number;
  message: string;
}

export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let counter = 0;
    const onToast = (e: Event) => {
      const message = String((e as CustomEvent).detail ?? "");
      if (!message) return;
      const id = ++counter;
      setItems((prev) => [...prev.slice(-2), { id, message }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3200);
    };
    window.addEventListener("ss:toast", onToast);
    return () => window.removeEventListener("ss:toast", onToast);
  }, []);

  if (!items.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-1.5"
      style={{ bottom: "calc(max(70px, env(safe-area-inset-bottom) + 64px))" }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="fade-in max-w-[92vw] rounded-lg border border-[var(--border-default)] bg-ink-600 px-3.5 py-2 text-[12px] text-t100"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
