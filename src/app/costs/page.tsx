import { asc, desc } from "drizzle-orm";
import { requireAuth, authEnabled } from "@/lib/auth";
import {
  getDb,
  episodes,
  generations,
  knowledgeDocs,
  llmUsage,
  shots,
  videoModels,
} from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { saveSettings, logoutAction } from "@/lib/actions/settings";
import { ScreenHeader, SectionLabel, EmptyState } from "@/components/ui";
import KnowledgeIngest from "@/components/costs/KnowledgeIngest";
import CatalogRefresh from "@/components/costs/CatalogRefresh";
import LimitStepper from "@/components/costs/LimitStepper";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteKnowledgeDoc, clearKnowledge } from "@/lib/actions/deletes";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  await requireAuth();
  const db = await getDb();
  const settings = await getAllSettings();
  const priceIn = Number(settings.llm_price_in) || 0;
  const priceOut = Number(settings.llm_price_out) || 0;

  const [docs, usage, gens, shotRows, epRows, models] = await Promise.all([
    db.select().from(knowledgeDocs).orderBy(desc(knowledgeDocs.createdAt)),
    db.select().from(llmUsage).orderBy(desc(llmUsage.createdAt)).limit(2000),
    db.select().from(generations),
    db.select().from(shots),
    db.select().from(episodes).orderBy(asc(episodes.number)),
    db.select().from(videoModels).orderBy(asc(videoModels.sortIndex)),
  ]);

  const episodeByShot = new Map(shotRows.map((s) => [s.id, s.episodeId]));
  const llmUsd = (rows: typeof usage) =>
    rows.reduce((sum, u) => sum + (u.inputTokens * priceIn + u.outputTokens * priceOut) / 1e6, 0);

  // M7: кредиты по эпизоду и модели
  const perEpisode = epRows.map((ep) => {
    // видео-задачи привязаны через шот, задачи-референсы — напрямую через episode_id
    const epGens = gens.filter(
      (g) => (g.shotId ? episodeByShot.get(g.shotId) : g.episodeId) === ep.id,
    );
    const credits = epGens.reduce((sum, g) => sum + (g.creditsSpent ?? 0), 0);
    const byModel = new Map<string, number>();
    for (const g of epGens) {
      if (g.creditsSpent) byModel.set(g.model, (byModel.get(g.model) ?? 0) + g.creditsSpent);
    }
    const usd = llmUsd(usage.filter((u) => u.episodeId === ep.id));
    return { ep, credits, byModel, usd, jobs: epGens.length };
  });
  const totalCredits = perEpisode.reduce((s, e) => s + e.credits, 0);
  const totalUsd = llmUsd(usage);
  // за текущий месяц — весь сериал (spec §2.9)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthCredits = gens
    .filter((g) => g.createdAt >= monthStart)
    .reduce((s, g) => s + (g.creditsSpent ?? 0), 0);
  const monthUsd = llmUsd(usage.filter((u) => u.createdAt >= monthStart));
  const maxModelCredits = Math.max(
    1,
    ...perEpisode.flatMap((e) => [...e.byModel.values()]),
  );

  const fields: Array<{ key: string; label: string; hint?: string; textarea?: boolean }> = [
    { key: "series_title", label: "Название сериала" },
    { key: "series_rules", label: "Правила сериала", hint: "тон, жанр, запреты — контекст всех LLM-вызовов", textarea: true },
    { key: "llm_model", label: "Модель LLM (промпты, раскадровка)" },
    { key: "llm_model_synopsis", label: "Модель LLM для сюжетов", hint: "например claude-opus-4-8" },
    { key: "llm_price_in", label: "Тариф LLM, $ за 1М входных токенов" },
    { key: "llm_price_out", label: "Тариф LLM, $ за 1М выходных токенов" },
    { key: "target_models", label: "Модели A/B по умолчанию (id через запятую)", hint: "из каталога ниже" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl">
      <ScreenHeader backHref="/episodes" eyebrow="Пульт" title="Затраты и настройки" />
      <div className="flex flex-col gap-6 p-4 pb-12">
        {/* M7 — сводка */}
        <div className="flex flex-col gap-2">
          <SectionLabel>Итого</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
              <div className="font-mono text-[20px] font-semibold text-t100">{totalCredits}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-t400">
                кредитов Higgsfield
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
              <div className="font-mono text-[20px] font-semibold text-t100">
                ${totalUsd.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-t400">
                LLM Anthropic · {usage.length} вызовов
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3.5 py-2.5 font-mono text-[11px] text-t300">
            За текущий месяц (весь сериал):{" "}
            <span className="text-t100">{monthCredits} кр</span> +{" "}
            <span className="text-t100">${monthUsd.toFixed(2)} LLM</span>
          </div>
        </div>

        {/* M7 — по эпизодам */}
        <div className="flex flex-col gap-2">
          <SectionLabel>По эпизодам</SectionLabel>
          {perEpisode.filter((e) => e.jobs > 0 || e.usd > 0).length === 0 && (
            <EmptyState>Затрат пока нет — запустите первую генерацию.</EmptyState>
          )}
          {perEpisode
            .filter((e) => e.jobs > 0 || e.usd > 0)
            .map(({ ep, credits, byModel, usd }) => (
              <div
                key={ep.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="eyebrow">Серия {String(ep.number).padStart(2, "0")}</span>
                  <span className="truncate text-[12.5px] font-semibold text-t100">{ep.title}</span>
                </div>
                {[...byModel.entries()].map(([model, cr]) => (
                  <div key={model} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate font-mono text-[10px] text-chrome-mid">
                      {model}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-sm bg-ink-800">
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${Math.max(4, (cr / maxModelCredits) * 100)}%`,
                          background: "linear-gradient(90deg, var(--violet-600), var(--violet-400))",
                        }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right font-mono text-[10px] text-t300">
                      {cr} кр
                    </span>
                  </div>
                ))}
                <div className="font-mono text-[11px] text-t300">
                  Серия обошлась в <span className="text-t100">{credits} кредитов</span> +{" "}
                  <span className="text-t100">${usd.toFixed(2)} LLM</span>
                </div>
              </div>
            ))}
        </div>

        {/* Каталог моделей (TZ §0.2) */}
        <div className="flex flex-col gap-2">
          <SectionLabel hint="живой каталог Higgsfield, хранится в БД">Каталог моделей</SectionLabel>
          {models.length ? (
            <div className="flex flex-col gap-1.5">
              {models.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2"
                >
                  <span className="font-mono text-[11px] font-semibold text-t100">{m.id}</span>
                  <span className="text-[11px] text-t300">{m.name}</span>
                  <span className="flex-1" />
                  <span className="rounded bg-ink-600 px-1.5 py-0.5 font-mono text-[9px] text-t400">
                    {m.kind}
                  </span>
                  <span className="font-mono text-[10px] text-t400">
                    {m.credits != null ? `~${m.credits} кр` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>Каталог пуст — нажмите «Обновить каталог моделей».</EmptyState>
          )}
          <CatalogRefresh />
        </div>

        {/* Настройки */}
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
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-t300">
              Лимит подтверждения — задачи дороже требуют двухшагового подтверждения
            </span>
            <LimitStepper
              name="credit_confirm_limit"
              initial={Number(settings.credit_confirm_limit) || 50}
            />
          </label>
          <button
            type="submit"
            className="min-h-12 rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            Сохранить настройки
          </button>
        </form>

        {/* База знаний */}
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
                  <ConfirmButton
                    action={deleteKnowledgeDoc.bind(null, d.id)}
                    label="🗑"
                    confirmLabel="Удалить?"
                    className="rounded px-1 text-[11px] text-t400 hover:text-danger disabled:opacity-50"
                    armedClassName="text-danger"
                  />
                </div>
              ))}
              {docs.length > 1 && (
                <ConfirmButton
                  action={clearKnowledge}
                  label={`Очистить базу знаний (${docs.length})`}
                  confirmLabel="Точно очистить всю базу знаний?"
                  doneToast="База знаний очищена"
                  className="mt-1 min-h-10 rounded-lg border border-[rgba(194,71,106,.35)] text-[11px] font-semibold uppercase tracking-[0.1em] text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
                />
              )}
            </div>
          ) : (
            <EmptyState>
              Положите свои PDF-материалы (конвертированные в .md) в папку /knowledge и нажмите
              «Обновить».
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
