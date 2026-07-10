import { desc } from "drizzle-orm";
import { requireAuth, authEnabled } from "@/lib/auth";
import { getDb, knowledgeDocs, llmUsage } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { saveSettings, logoutAction } from "@/lib/actions/settings";
import { ScreenHeader, SectionLabel, EmptyState } from "@/components/ui";
import KnowledgeIngest from "@/components/costs/KnowledgeIngest";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  await requireAuth();
  const db = await getDb();
  const settings = await getAllSettings();
  const docs = await db.select().from(knowledgeDocs).orderBy(desc(knowledgeDocs.createdAt));
  const usage = await db.select().from(llmUsage).orderBy(desc(llmUsage.createdAt)).limit(500);

  const totalIn = usage.reduce((sum, u) => sum + u.inputTokens, 0);
  const totalOut = usage.reduce((sum, u) => sum + u.outputTokens, 0);
  // грубая оценка $ по тарифам Sonnet ($3/$15 за 1M токенов)
  const estUsd = (totalIn * 3 + totalOut * 15) / 1_000_000;

  const fields: Array<{ key: string; label: string; hint?: string; textarea?: boolean }> = [
    { key: "series_title", label: "Название сериала" },
    { key: "series_rules", label: "Правила сериала", hint: "тон, жанр, запреты — контекст всех LLM-вызовов", textarea: true },
    { key: "llm_model", label: "Модель LLM (промпты, раскадровка)" },
    { key: "llm_model_synopsis", label: "Модель LLM для сюжетов", hint: "например claude-opus-4-8" },
    { key: "target_models", label: "Видеомодели (через запятую)", hint: "будут заменены живым каталогом Higgsfield на Этапе 2" },
    { key: "credit_confirm_limit", label: "Подтверждать задачи дороже N кредитов", hint: "Этап 2" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/episodes" eyebrow="Пульт" title="Затраты и настройки" />
      <div className="flex flex-col gap-6 p-4 pb-12">
        <div className="flex flex-col gap-2">
          <SectionLabel>Затраты LLM (Anthropic)</SectionLabel>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-4">
            <div className="font-mono text-[22px] font-semibold text-t100">
              ≈ ${estUsd.toFixed(2)}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-t400">
              {usage.length} вызовов · {totalIn.toLocaleString("ru")} вх. ·{" "}
              {totalOut.toLocaleString("ru")} исх. токенов
            </div>
          </div>
          <div className="text-[10.5px] text-t400">
            Кредиты Higgsfield по эпизодам и моделям появятся на Этапе 2.
          </div>
        </div>

        <form action={saveSettings} className="flex flex-col gap-3">
          <SectionLabel>Настройки</SectionLabel>
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-t300">
                {f.label}
                {f.hint && <span className="text-t400"> — {f.hint}</span>}
              </span>
              {f.textarea ? (
                <textarea
                  name={f.key}
                  defaultValue={settings[f.key as keyof typeof settings]}
                  rows={4}
                  className="resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 text-[12.5px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
                />
              ) : (
                <input
                  name={f.key}
                  defaultValue={settings[f.key as keyof typeof settings]}
                  className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 font-mono text-[12.5px] text-t100 outline-none focus:border-[var(--border-strong)]"
                />
              )}
            </label>
          ))}
          <button
            type="submit"
            className="min-h-12 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            Сохранить настройки
          </button>
        </form>

        <div className="flex flex-col gap-2">
          <SectionLabel hint="папка /knowledge в проекте (.md, .txt)">
            База знаний промпт-фабрики
          </SectionLabel>
          {docs.length ? (
            <div className="flex flex-col gap-1.5">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-t200">{d.title}</span>
                  <span className="font-mono text-[9.5px] text-violet-300">{d.tags}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>
              Положите свои PDF-материалы (конвертированные в .md) в папку /knowledge и нажмите
              «Обновить» — фабрика будет использовать их при сборке промптов.
            </EmptyState>
          )}
          <KnowledgeIngest />
        </div>

        {authEnabled() && (
          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-[0.1em] text-t300 hover:text-t100"
            >
              Выйти
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
