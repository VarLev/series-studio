"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { ScreenHeader, EmptyState } from "@/components/ui";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { clearConsoleLog } from "@/lib/actions/console";

export interface LogRefView {
  id: string;
  url: string | null;
  caption: string;
  role: string | null;
}

export interface LogRowView {
  id: string;
  createdAt: string;
  channel: "llm" | "video" | "image";
  kind: string;
  provider: string;
  model: string;
  status: "ok" | "error";
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  refs: LogRefView[];
}

const CHANNELS = [
  { id: "all", ru: "Все", en: "All" },
  { id: "llm", ru: "LLM", en: "LLM" },
  { id: "video", ru: "Видео", en: "Video" },
  { id: "image", ru: "Картинки", en: "Images" },
] as const;

function channelColor(channel: LogRowView["channel"]): string {
  if (channel === "video") return "var(--warning)";
  if (channel === "image") return "var(--success)";
  return "var(--violet-300)";
}

function channelLabel(channel: LogRowView["channel"]): string {
  if (channel === "video") return "VIDEO";
  if (channel === "image") return "IMAGE";
  return "LLM";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function fmtDuration(ms: number): string {
  if (!ms) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2);
}

/** Титульный блок с моноширинным текстом и кнопкой копирования. */
function TextBlock({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
          {label}
        </span>
        <span className="text-[9px] text-t400">{value.length}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="ml-auto text-[9.5px] font-semibold uppercase tracking-[0.08em] text-t400 hover:text-t200"
        >
          {copied ? t("✓ скопировано", "✓ copied") : t("копировать", "copy")}
        </button>
      </div>
      <pre
        className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-2.5 font-mono text-[11px] leading-relaxed"
        style={{ color: danger ? "var(--danger)" : "var(--text-200)" }}
      >
        {value}
      </pre>
    </div>
  );
}

/** Маленькие чипы «ключ: значение» для коротких полей. */
function Chips({ entries }: { entries: Array<[string, string]> }) {
  const list = entries.filter(([, v]) => v !== "" && v !== "false" && v !== "0");
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map(([k, v]) => (
        <span
          key={k}
          className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300"
        >
          <span className="text-t400">{k}:</span> {v}
        </span>
      ))}
    </div>
  );
}

function RefThumbs({ refs, emptyLabel }: { refs: LogRefView[]; emptyLabel: string }) {
  if (!refs.length) return null;
  return (
    <div className="grid grid-cols-4 gap-2">
      {refs.map((r) => (
        <a
          key={r.id + (r.role ?? "")}
          href={r.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-ink-600"
        >
          {r.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.url} alt="" loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center text-[9px] text-t400">
              {emptyLabel}
            </div>
          )}
          <span className="truncate px-1 py-0.5 text-[8px] text-t400">
            {r.role ? `${r.role}` : ""}
            {r.role && r.caption ? " · " : ""}
            {r.caption}
          </span>
        </a>
      ))}
    </div>
  );
}

export default function ConsoleClient({
  items,
  title,
  subtitle,
  bare = false,
}: {
  items: LogRowView[];
  title: string;
  subtitle: string;
  /**
   * Рендер без экранной обвязки — для правой панели: заголовок и закрытие там
   * уже даёт слайдер, а вторая шапка с «назад» рядом с ним была бы враньём.
   * Действия шапки (обновить/очистить) при этом не теряются — уезжают в строку
   * над списком.
   */
  bare?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [channel, setChannel] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [selected, setSelected] = useState<LogRowView | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (channel !== "all" && r.channel !== channel) return false;
      if (errorsOnly && r.status !== "error") return false;
      if (!q) return true;
      const hay =
        `${r.model} ${r.provider} ${r.kind} ${asString(r.request.system)} ${asString(r.request.user)} ` +
        `${asString(r.request.prompt)} ${asString(r.response.text)} ${asString(r.response.error)}`;
      return hay.toLowerCase().includes(q);
    });
  }, [items, channel, query, errorsOnly]);

  const actions = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => startTransition(() => router.refresh())}
        className="flex h-9 w-9 items-center justify-center rounded-md text-t300 hover:bg-ink-500"
        title={t("Обновить", "Refresh")}
      >
        ⟳
      </button>
      {items.length > 0 && (
        <ConfirmButton
          action={async () => {
            await clearConsoleLog();
            toast(t("Журнал очищен", "Log cleared"));
          }}
          label="🗑"
          confirmLabel={t("Очистить журнал?", "Clear the log?")}
          className="flex h-9 items-center rounded-md px-2 text-[12px] text-t400 hover:text-danger disabled:opacity-50"
          armedClassName="text-danger"
        />
      )}
    </div>
  );

  return (
    <main
      className={
        bare
          ? "flex w-full flex-col"
          : "mx-auto flex min-h-dvh w-full max-w-lg flex-col md:max-w-3xl"
      }
    >
      {bare ? (
        <div className="flex items-center justify-end px-4 pt-3">{actions}</div>
      ) : (
        <ScreenHeader
          backHref="/episodes"
          eyebrow={t("Пульт", "Console")}
          title={title}
          right={actions}
        />
      )}

      <div className="flex flex-col gap-2 p-4 pb-10">
        <p className="text-[11px] leading-relaxed text-t400">{subtitle}</p>

        {/* фильтры */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CHANNELS.map((c) => {
            const active = channel === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setChannel(c.id)}
                className="min-h-8 rounded-md border px-2.5 text-[11px] font-semibold"
                style={{
                  borderColor: active ? "var(--border-strong)" : "var(--border-subtle)",
                  background: active ? "var(--ink-600)" : "transparent",
                  color: active ? "var(--text-100)" : "var(--text-400)",
                }}
              >
                {t(c.ru, c.en)}
              </button>
            );
          })}
          <button
            onClick={() => setErrorsOnly((v) => !v)}
            className="min-h-8 rounded-md border px-2.5 text-[11px] font-semibold"
            style={{
              borderColor: errorsOnly ? "var(--danger)" : "var(--border-subtle)",
              background: errorsOnly ? "rgba(194,71,106,.12)" : "transparent",
              color: errorsOnly ? "var(--danger)" : "var(--text-400)",
            }}
          >
            {t("Ошибки", "Errors")}
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Поиск по промпту, модели…", "Search prompt, model…")}
            className="min-h-8 min-w-[140px] flex-1 rounded-md border border-[var(--border-subtle)] bg-ink-800 px-2.5 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
          />
        </div>

        {/* список */}
        {filtered.length === 0 ? (
          <EmptyState>
            {items.length === 0
              ? t(
                  "Журнал пуст. Сгенерируйте промпт, проанализируйте референс или запустите генерацию — записи появятся здесь.",
                  "The log is empty. Generate a prompt, analyze a reference or start a generation — entries will appear here.",
                )
              : t("Ничего не найдено по фильтру.", "Nothing matches the filter.")}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 text-left hover:border-[var(--border-strong)]"
              >
                <span
                  className="w-12 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[8.5px] font-bold uppercase tracking-[0.06em]"
                  style={{ background: "var(--ink-600)", color: channelColor(r.channel) }}
                >
                  {channelLabel(r.channel)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-t100">
                    {r.model || r.provider}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[9.5px] text-t400">
                    {r.kind}
                    {r.provider ? ` · ${r.provider}` : ""}
                    {r.refs.length ? ` · 📎${r.refs.length}` : ""}
                    {fmtDuration(r.durationMs) ? ` · ${fmtDuration(r.durationMs)}` : ""}
                    {r.inputTokens || r.outputTokens
                      ? ` · ${r.inputTokens}→${r.outputTokens} tok`
                      : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-[9px] text-t400">{fmtTime(r.createdAt)}</span>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: r.status === "error" ? "var(--danger)" : "var(--success)" }}
                  />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* детальный просмотр */}
      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${channelLabel(selected.channel)} · ${selected.model || selected.provider}` : ""}
      >
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            {/* мета */}
            <div className="flex flex-wrap gap-1.5">
              {[
                selected.provider,
                selected.kind,
                `${fmtDate(selected.createdAt)} ${fmtTime(selected.createdAt)}`,
                fmtDuration(selected.durationMs),
                selected.inputTokens || selected.outputTokens
                  ? `${selected.inputTokens}→${selected.outputTokens} tok`
                  : "",
                selected.status === "error" ? t("ОШИБКА", "ERROR") : "",
              ]
                .filter(Boolean)
                .map((m, i) => (
                  <span
                    key={i}
                    className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px]"
                    style={{ color: m === t("ОШИБКА", "ERROR") ? "var(--danger)" : "var(--text-300)" }}
                  >
                    {m}
                  </span>
                ))}
            </div>

            {/* ── Отправлено ── */}
            <div className="section-label mt-1">{t("→ Отправлено в модель", "→ Sent to model")}</div>
            <TextBlock label={t("System", "System")} value={asString(selected.request.system)} />
            <TextBlock label={t("User", "User")} value={asString(selected.request.user)} />
            <TextBlock label={t("Промпт", "Prompt")} value={asString(selected.request.prompt)} />
            <TextBlock
              label={t("Negative", "Negative")}
              value={asString(selected.request.negativePrompt)}
            />
            {selected.request.params != null && (
              <TextBlock label={t("Параметры", "Params")} value={asString(selected.request.params)} />
            )}
            <Chips
              entries={[
                [t("картинка", "image"), selected.request.hasImage ? "✓" : ""],
                ["media", asString(selected.request.imageMediaType)],
                [t("стартовый кадр", "start frame"), selected.request.startFrame ? "✓" : ""],
                ["max_tokens", asString(selected.request.maxTokens)],
              ]}
            />

            {/* прикреплённые референсы */}
            {selected.refs.length > 0 && (
              <>
                <div className="section-label mt-1">
                  {t("📎 Прикреплённые референсы", "📎 Attached references")} · {selected.refs.length}
                </div>
                <RefThumbs refs={selected.refs} emptyLabel={t("нет превью", "no preview")} />
              </>
            )}

            {/* ── Ответ ── */}
            <div className="section-label mt-1">{t("← Ответ модели", "← Model response")}</div>
            <TextBlock label={t("Текст", "Text")} value={asString(selected.response.text)} />
            <TextBlock label="error" value={asString(selected.response.error)} danger />
            <Chips
              entries={[
                ["job_id", asString(selected.response.jobId)],
                ["status_url", asString(selected.response.statusUrl)],
              ]}
            />
          </div>
        )}
      </Sheet>
    </main>
  );
}
