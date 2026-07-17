"use client";

/**
 * «База правил» (/rules): четыре секции —
 *  1) пользовательские правила (CRUD + вкл/выкл + scope/family);
 *  2) системные правила реестра (текст из кода, только вкл/выкл);
 *  3) динамические блоки (вкл/выкл с предупреждением);
 *  4) правила из шаблонов (read-only, кнопка «Обновить из шаблонов»).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import { SectionLabel } from "@/components/ui";
import { useT } from "@/components/I18nProvider";
import {
  SYSTEM_RULES,
  DYNAMIC_BLOCKS,
  SITE_LABELS,
  type RuleSite,
} from "@/lib/llm/rulesRegistry";
import {
  deleteUserRule,
  refreshTemplateRules,
  saveUserRule,
  toggleRuleState,
  toggleUserRule,
} from "@/lib/actions/rulesPage";

export interface UserRuleCard {
  id: string;
  title: string;
  text: string;
  scope: string;
  family: string;
  enabled: boolean;
}

export interface TemplateRuleCard {
  id: string;
  templateKey: string;
  title: string;
  text: string;
}

export interface TemplateStatusCard {
  templateKey: string;
  count: number;
  stale: boolean;
  empty: boolean;
}

const TEMPLATE_LABELS: Record<string, { ru: string; en: string }> = {
  tpl_breakdown: { ru: "Разбивка сюжета", en: "Story breakdown" },
  tpl_video: { ru: "Видео-промпт · Seedance", en: "Video prompt · Seedance" },
  tpl_video_kling: { ru: "Видео-промпт · Kling", en: "Video prompt · Kling" },
};

function UsageBadges({ usedIn }: { usedIn: RuleSite[] }) {
  const t = useT();
  return (
    <span className="flex flex-wrap gap-1">
      {usedIn.map((site) => (
        <span
          key={site}
          className="rounded border border-[var(--border-subtle)] bg-ink-600 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-t300"
        >
          {t(SITE_LABELS[site].ru, SITE_LABELS[site].en)}
        </span>
      ))}
    </span>
  );
}

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Тумблер вкл/выкл: оптимистичный, с server action. Провал ОБЯЗАН вернуться
 * тостом и откатом: молча отброшенный {ok:false} выглядел как успех, а
 * незанулённое оптимистичное значение залипало в непрожатом состоянии.
 */
function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => Promise<ActionResult>;
  disabled?: boolean;
}) {
  const t = useT();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const value = optimistic ?? enabled;
  return (
    <button
      role="switch"
      aria-checked={value}
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation();
        const next = !value;
        setOptimistic(next);
        startTransition(async () => {
          try {
            const res = await onChange(next);
            if (!res.ok) toast(res.error || t("Ошибка", "Error"));
          } catch (err) {
            toast(err instanceof Error ? err.message : t("Ошибка", "Error"));
          } finally {
            setOptimistic(null);
          }
        });
      }}
      className="relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50"
      style={{
        background: value ? "var(--violet-500, #7c5cff)" : "var(--ink-500, #2a2733)",
        borderColor: value ? "transparent" : "var(--border-default)",
      }}
    >
      <span
        className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all"
        style={{ left: value ? "calc(100% - 16px)" : "2px" }}
      />
    </button>
  );
}

export default function RulesClient({
  disabledIds,
  userRules,
  templateRules,
  templateStatus,
}: {
  disabledIds: string[];
  userRules: UserRuleCard[];
  templateRules: TemplateRuleCard[];
  templateStatus: TemplateStatusCard[];
}) {
  const t = useT();
  const router = useRouter();
  const disabled = new Set(disabledIds);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserRuleCard | null>(null);
  // enabled на момент открытия шита: по нему видно, трогал ли пользователь чекбокс
  const [openedEnabled, setOpenedEnabled] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  const scopeLabel = (scope: string) =>
    scope === "breakdown"
      ? t("Разбивка на шоты", "Breakdown")
      : scope === "video_prompt"
        ? t("Видео-промпт", "Video prompt")
        : t("Везде", "Everywhere");
  const familyLabel = (family: string) =>
    family === "seedance" ? "Seedance" : family === "kling" ? "Kling" : t("Оба трека", "Both tracks");

  function openNew() {
    setDraft({ id: "", title: "", text: "", scope: "all", family: "all", enabled: true });
    setOpenedEnabled(true);
  }

  function openEdit(r: UserRuleCard) {
    setDraft({ ...r });
    setOpenedEnabled(r.enabled);
  }

  function submitDraft() {
    if (!draft) return;
    startTransition(async () => {
      const current = draft.id ? userRules.find((x) => x.id === draft.id) : undefined;
      // чекбокс в шите не трогали → пишем АКТУАЛЬНОЕ значение из пропа, а не своё:
      // draft — снимок на момент открытия, и тумблер в списке мог переключить
      // правило уже после него (иначе сохранение молча воскрешало выключенное)
      const enabled =
        current && draft.enabled === openedEnabled ? current.enabled : draft.enabled;
      const res = await saveUserRule({
        id: draft.id || undefined,
        title: draft.title,
        text: draft.text,
        scope: draft.scope as "all" | "breakdown" | "video_prompt",
        family: draft.family as "all" | "seedance" | "kling",
        enabled,
      });
      if (res.ok) {
        toast(draft.id ? t("Правило обновлено", "Rule updated") : t("Правило добавлено", "Rule added"));
        setDraft(null);
        router.refresh();
      } else toast(("error" in res && res.error) || t("Ошибка", "Error"));
    });
  }

  function doRefreshTemplates() {
    startRefresh(async () => {
      const res = await refreshTemplateRules();
      if (!res.ok) {
        toast(res.error || t("Ошибка", "Error"));
        return;
      }
      const updated = res.results.filter((r) => !r.skipped);
      toast(
        updated.length
          ? t(
              `Обновлено шаблонов: ${updated.length} (правил: ${updated.reduce((s, r) => s + r.count, 0)})`,
              `Templates updated: ${updated.length} (${updated.reduce((s, r) => s + r.count, 0)} rules)`,
            )
          : t("Без изменений — шаблоны не менялись", "No changes — templates unchanged"),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-10">
      {/* ---------- 1. Пользовательские правила ---------- */}
      <div className="flex items-center gap-3">
        <SectionLabel>{t("Пользовательские правила", "Your rules")}</SectionLabel>
        <span className="flex-1" />
        <button
          onClick={openNew}
          className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-violet-200 hover:text-violet-100"
        >
          {t("+ Добавить правило", "+ Add rule")}
        </button>
      </div>
      <p className="text-[10.5px] leading-relaxed text-t400">
        {t(
          "Короткие директивы, которые вклеиваются в системный промпт высокоприоритетным блоком. Область действия: «Разбивка» — разбивка сюжета и правки групп (Rework/Вставка/Enhance); «Видео-промпт» — генерация и ревизия промптов шотов (с фильтром по треку Seedance/Kling).",
          "Short directives injected into the system prompt as a high-priority block. Scope: “Breakdown” covers story breakdown and group edits (Rework/Insert/Enhance); “Video prompt” covers shot prompt generation and revision (with Seedance/Kling track filter).",
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        {userRules.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5"
          >
            <button onClick={() => openEdit(r)} className="min-w-0 flex-1 text-left">
              <span className={`block truncate text-[12.5px] font-medium ${r.enabled ? "text-t100" : "text-t400 line-through"}`}>
                {r.title || r.text.slice(0, 60)}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-t400">
                {scopeLabel(r.scope)}
                {r.scope !== "breakdown" ? ` · ${familyLabel(r.family)}` : ""}
              </span>
            </button>
            <Toggle enabled={r.enabled} onChange={(v) => toggleUserRule(r.id, v)} />
          </div>
        ))}
        {userRules.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-[11px] text-t400">
            {t("Своих правил пока нет", "No custom rules yet")}
          </div>
        )}
      </div>

      {/* ---------- 2. Системные правила ---------- */}
      <SectionLabel>{t("Системные правила", "System rules")}</SectionLabel>
      <p className="text-[10.5px] leading-relaxed text-t400">
        {t(
          "Текст этих правил живёт в коде и обновляется с релизами; здесь их можно включать и выключать. Бейджи показывают, в какие вызовы модели правило вклеивается.",
          "Rule texts live in code and update with releases; here you can toggle them on/off. Badges show which model calls each rule is injected into.",
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        {SYSTEM_RULES.map((r) => {
          const on = !disabled.has(r.id);
          const open = openId === r.id;
          return (
            <div key={r.id} className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-700">
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <button onClick={() => setOpenId(open ? null : r.id)} className="min-w-0 flex-1 text-left">
                  <span className={`block text-[12.5px] font-medium ${on ? "text-t100" : "text-t400 line-through"}`}>
                    {r.title} <span className="text-t400">{open ? "▴" : "▾"}</span>
                  </span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-t400">{r.description}</span>
                  <span className="mt-1.5 block">
                    <UsageBadges usedIn={r.usedIn} />
                  </span>
                </button>
                <Toggle enabled={on} onChange={(v) => toggleRuleState(r.id, v)} />
              </div>
              {open && (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t200">
                  {r.text}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------- 3. Динамические блоки ---------- */}
      <SectionLabel>{t("Динамические блоки", "Dynamic blocks")}</SectionLabel>
      <div className="rounded-lg border border-[rgba(224,178,80,.35)] bg-[rgba(224,178,80,.07)] px-3 py-2.5 text-[10.5px] leading-relaxed text-t300">
        ⚠︎{" "}
        {t(
          "Эти блоки собираются из данных проекта (референсы, гардероб, локация…) при каждом вызове — их текст меняется от группы к группе. Отключение может сломать функцию: например, фиксацию гардероба или привязку к стартовому кадру.",
          "These blocks are assembled from project data (references, wardrobe, location…) on every call — their text differs per group. Disabling one can break a feature, e.g. the wardrobe lock or the start-frame anchor.",
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {DYNAMIC_BLOCKS.map((b) => {
          const on = !disabled.has(b.id);
          return (
            <div
              key={b.id}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <span className={`block text-[12.5px] font-medium ${on ? "text-t100" : "text-t400 line-through"}`}>
                  {b.title}
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-t400">{b.description}</span>
                {!on && b.warning && (
                  <span className="mt-1 block text-[10px] leading-relaxed text-danger">⚠︎ {b.warning}</span>
                )}
                <span className="mt-1.5 block">
                  <UsageBadges usedIn={b.usedIn} />
                </span>
              </div>
              <Toggle enabled={on} onChange={(v) => toggleRuleState(b.id, v)} />
            </div>
          );
        })}
      </div>

      {/* ---------- 4. Правила из шаблонов ---------- */}
      <div className="flex items-center gap-3">
        <SectionLabel>{t("Правила из шаблонов", "Template rules")}</SectionLabel>
        <span className="flex-1" />
        <button
          onClick={doRefreshTemplates}
          disabled={refreshing}
          className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-violet-200 hover:text-violet-100 disabled:opacity-50"
        >
          {refreshing ? t("Обновляю…", "Refreshing…") : t("⟳ Обновить из шаблонов", "⟳ Refresh from templates")}
        </button>
      </div>
      <p className="text-[10.5px] leading-relaxed text-t400">
        {t(
          "Витрина правил, извлечённых моделью из редактируемых шаблонов (Настройки → Шаблоны промптов). Только просмотр: править нужно сам шаблон, затем нажать «Обновить». Пересегментируются только изменившиеся шаблоны (3 вызова модели простых запросов максимум).",
          "A read-only view of the rules the model extracted from your editable templates (Settings → Prompt templates). Edit the template itself, then hit Refresh. Only changed templates are re-segmented (at most 3 simple-model calls).",
        )}
      </p>
      {templateStatus.map((s) => {
        const label = TEMPLATE_LABELS[s.templateKey] ?? { ru: s.templateKey, en: s.templateKey };
        const rules = templateRules.filter((r) => r.templateKey === s.templateKey);
        return (
          <div key={s.templateKey} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-0.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-t300">
                {t(label.ru, label.en)} · {s.count}
              </span>
              <span
                className="rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em]"
                style={
                  s.empty
                    ? { borderColor: "var(--border-default)", color: "var(--text-400)" }
                    : s.stale
                      ? { borderColor: "rgba(224,178,80,.4)", color: "rgb(224,178,80)" }
                      : { borderColor: "rgba(110,190,130,.4)", color: "var(--success, rgb(110,190,130))" }
                }
              >
                {s.empty ? t("нет данных", "no data") : s.stale ? t("устарело", "stale") : t("актуально", "up to date")}
              </span>
            </div>
            {rules.map((r) => {
              const open = openId === r.id;
              return (
                <div key={r.id} className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-700">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-t100">
                      {r.title || r.text.slice(0, 60)}
                    </span>
                    <span className="text-[10px] text-t400">{open ? "▴" : "▾"}</span>
                  </button>
                  {open && (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t200">
                      {r.text}
                    </pre>
                  )}
                </div>
              );
            })}
            {rules.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-3 text-center text-[10.5px] text-t400">
                {t("Нажмите «Обновить из шаблонов», чтобы извлечь правила", "Hit “Refresh from templates” to extract rules")}
              </div>
            )}
          </div>
        );
      })}

      {/* ---------- Sheet: создание/правка пользовательского правила ---------- */}
      <Sheet
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("Правка правила", "Edit rule") : t("Новое правило", "New rule")}
      >
        {draft && (
          <div className="flex flex-col gap-2 pb-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("Название (необязательно)", "Title (optional)")}
              className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={6}
              placeholder={t(
                "Текст правила — короткая директива для модели…",
                "Rule text — a short directive for the model…",
              )}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="section-label">{t("Где действует", "Scope")}</span>
                <select
                  value={draft.scope}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      scope: e.target.value,
                      family: e.target.value === "breakdown" ? "all" : draft.family,
                    })
                  }
                  className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
                >
                  <option value="all">{t("Везде", "Everywhere")}</option>
                  <option value="breakdown">{t("Разбивка на шоты", "Breakdown")}</option>
                  <option value="video_prompt">{t("Видео-промпт", "Video prompt")}</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="section-label">{t("Трек", "Track")}</span>
                <select
                  value={draft.family}
                  disabled={draft.scope === "breakdown"}
                  onChange={(e) => setDraft({ ...draft, family: e.target.value })}
                  className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none disabled:opacity-50"
                >
                  <option value="all">{t("Оба трека", "Both tracks")}</option>
                  <option value="seedance">Seedance</option>
                  <option value="kling">Kling</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 py-1 text-[12px] text-t200">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              {t("Правило включено", "Rule enabled")}
            </label>
            <button
              onClick={submitDraft}
              disabled={pending || !draft.text.trim()}
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? t("Сохранение…", "Saving…") : t("Сохранить правило", "Save rule")}
            </button>
            {draft.id && (
              <ConfirmButton
                action={async () => {
                  const res = await deleteUserRule(draft.id);
                  if (res.ok) {
                    setDraft(null);
                    router.refresh();
                  } else toast(res.error || t("Ошибка", "Error"));
                  return res; // ConfirmButton не должен рапортовать об успехе на провале
                }}
                label={t("Удалить правило", "Delete rule")}
                confirmLabel={t("Точно удалить правило?", "Really delete this rule?")}
                doneToast={t("Правило удалено", "Rule deleted")}
                className="min-h-10 w-full rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
