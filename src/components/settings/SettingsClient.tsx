"use client";

/**
 * Настройки: три шаблона промптов (разбивка сюжета / лист раскадровки / видео)
 * и библиотека режиссёрских приёмов (сид JSFilmz Vault + свои карточки).
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/components/Sheet";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import {
  saveTemplate,
  resetTemplate,
  saveTechnique,
  deleteTechnique,
  deleteAllTechniques,
  saveUiPref,
  saveSimpleModel,
  hfMcpDisconnect,
  hfMcpListTools,
  klingMcpDisconnect,
  klingWhoAmI,
} from "@/lib/actions/settingsPage";
import { SectionLabel } from "@/components/ui";
import FullscreenCard from "@/components/settings/FullscreenCard";
import { SIMPLE_LLM_MODELS } from "@/lib/llm/models";
import { useT } from "@/components/I18nProvider";

export interface TechniqueCard {
  id: string;
  title: string;
  category: string;
  camera: string;
  lens: string;
  lighting: string;
  tags: string;
  prompt: string;
  negative: string;
  custom: boolean;
}

const PAGE = 60;

function TemplateEditor({
  settingKey,
  title,
  hint,
  initial,
}: {
  settingKey: "tpl_breakdown" | "tpl_storyboard" | "tpl_video";
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
                await resetTemplate(settingKey);
                setValue(initial); // сервер отдаст стандартный после refresh
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

function HiggsfieldConnect({ connected }: { connected: boolean }) {
  const t = useT();
  const [tools, setTools] = useState<Array<{ name: string; description: string }> | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setChecking(true);
    setError("");
    const res = await hfMcpListTools();
    setChecking(false);
    if (res.ok) setTools(res.tools);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: connected ? "var(--success)" : "var(--text-400)" }}
        />
        <span className="text-[13px] font-semibold text-t100">
          {connected
            ? t("Higgsfield подключён — видео на кредитах подписки", "Higgsfield connected — video on plan credits")
            : t("Higgsfield не подключён", "Higgsfield not connected")}
        </span>
      </div>
      <div className="text-[10.5px] leading-relaxed text-t400">
        {t(
          "Подключение через ваш аккаунт Higgsfield (OAuth, без API-ключей). Генерация видео Kling/Seedance списывает кредиты подписки — как при ручной работе на сайте, без отдельной оплаты Cloud API.",
          "Connects via your Higgsfield account (OAuth, no API keys). Kling/Seedance video generation spends your plan credits — same as working on the site, no separate Cloud API billing.",
        )}
      </div>
      <div className="flex gap-2">
        {connected ? (
          <>
            <button
              onClick={check}
              disabled={checking}
              className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500 disabled:opacity-50"
            >
              {checking ? t("Проверяю…", "Checking…") : t("Проверить (список моделей)", "Test (list models)")}
            </button>
            <ConfirmButton
              action={async () => {
                await hfMcpDisconnect();
              }}
              label={t("Отключить", "Disconnect")}
              confirmLabel={t("Отключить аккаунт?", "Disconnect account?")}
              doneToast={t("Higgsfield отключён", "Higgsfield disconnected")}
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
            />
          </>
        ) : (
          <a
            href="/api/higgsfield/oauth/start"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {t("Подключить аккаунт Higgsfield", "Connect Higgsfield account")}
          </a>
        )}
      </div>
      {error && <div className="text-[11px] text-danger">{error}</div>}
      {tools && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-2.5">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-t400">
            {t(`Инструменты сервера · ${tools.length}`, `Server tools · ${tools.length}`)}
          </span>
          {tools.map((tool) => (
            <div key={tool.name} className="text-[11px] leading-relaxed text-t200">
              <span className="font-mono text-violet-200">{tool.name}</span>
              {tool.description && <span className="text-t400"> — {tool.description.slice(0, 120)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KlingConnect({ connected }: { connected: boolean }) {
  const t = useT();
  const [info, setInfo] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setChecking(true);
    setError("");
    const res = await klingWhoAmI();
    setChecking(false);
    if (res.ok) setInfo(res.text);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: connected ? "var(--success)" : "var(--text-400)" }}
        />
        <span className="text-[13px] font-semibold text-t100">
          {connected
            ? t("Kling подключён — видео на кредитах подписки Kling", "Kling connected — video on Kling plan credits")
            : t("Kling не подключён", "Kling not connected")}
        </span>
      </div>
      <div className="text-[10.5px] leading-relaxed text-t400">
        {t(
          "Официальный Kling MCP (kling.ai/mcp): вход через ваш аккаунт Kling (OAuth, без ключей). Списывает ПЛАТНЫЕ кредиты подписки по ценам платформы. Ограничения Kling: бонусные кредиты и off-peak-бесплатные генерации через API не работают; только Personal-воркспейс; ссылки на результат живут 24 часа (приложение скачивает файл сразу).",
          "Official Kling MCP (kling.ai/mcp): sign in with your Kling account (OAuth, no keys). Spends PAID plan credits at platform pricing. Kling limits: bonus credits and off-peak free generations don't work via API; Personal workspace only; result URLs live 24h (the app downloads files immediately).",
        )}
      </div>
      <div className="flex gap-2">
        {connected ? (
          <>
            <button
              onClick={check}
              disabled={checking}
              className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500 disabled:opacity-50"
            >
              {checking ? t("Проверяю…", "Checking…") : t("Проверить (who_am_i: модели)", "Test (who_am_i: models)")}
            </button>
            <ConfirmButton
              action={async () => {
                await klingMcpDisconnect();
              }}
              label={t("Отключить", "Disconnect")}
              confirmLabel={t("Отключить аккаунт?", "Disconnect account?")}
              doneToast={t("Kling отключён", "Kling disconnected")}
              className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
            />
          </>
        ) : (
          <a
            href="/api/kling/oauth/start"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400"
            style={{ boxShadow: "var(--glow-violet-sm)" }}
          >
            {t("Подключить аккаунт Kling", "Connect Kling account")}
          </a>
        )}
      </div>
      {error && <div className="text-[11px] text-danger">{error}</div>}
      {info && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-2.5 font-mono text-[10px] leading-relaxed text-t200">
          {info}
        </pre>
      )}
    </div>
  );
}

export default function SettingsClient({
  breakdownTemplate,
  storyboardTemplate,
  videoTemplate,
  techniques,
  uiLang,
  uiTheme,
  simpleModel,
  hfConnected,
  klingConnected,
}: {
  breakdownTemplate: string;
  storyboardTemplate: string;
  videoTemplate: string;
  techniques: TechniqueCard[];
  uiLang: string;
  uiTheme: string;
  simpleModel: string;
  hfConnected: boolean;
  klingConnected: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const tr = t; // алиас: внутри map((t) => …) имя t занято приёмом
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<TechniqueCard | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TechniqueCard | null>(null);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(
    () => [...new Set(techniques.map((t) => t.category).filter(Boolean))].sort(),
    [techniques],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return techniques.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      return `${t.title} ${t.tags} ${t.camera} ${t.prompt}`.toLowerCase().includes(q);
    });
  }, [techniques, query, category]);

  function openNew() {
    setDraft({
      id: "",
      title: "",
      category: "Свои приёмы",
      camera: "",
      lens: "",
      lighting: "",
      tags: "",
      prompt: "",
      negative: "",
      custom: true,
    });
    setEditing(true);
    setSelected(null);
  }

  function openEdit(t: TechniqueCard) {
    setDraft({ ...t });
    setEditing(true);
    setSelected(null);
  }

  function submitDraft() {
    if (!draft) return;
    startTransition(async () => {
      const res = await saveTechnique({
        id: draft.id || undefined,
        title: draft.title,
        category: draft.category,
        prompt: draft.prompt,
        negative: draft.negative,
        camera: draft.camera,
        tags: draft.tags,
      });
      if (res.ok) {
        toast(draft.id ? t("Приём обновлён", "Technique updated") : t("Приём добавлен", "Technique added"));
        setEditing(false);
        setDraft(null);
      } else toast(("error" in res && res.error) || t("Ошибка", "Error"));
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-10">
      <SectionLabel>{t("Интерфейс", "Interface")}</SectionLabel>
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className="section-label">{t("Язык", "Language")}</span>
          <select
            value={uiLang}
            onChange={(e) =>
              startTransition(async () => {
                await saveUiPref("ui_lang", e.target.value);
                router.refresh();
              })
            }
            className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="section-label">{t("Стиль", "Style")}</span>
          <select
            value={uiTheme}
            onChange={(e) =>
              startTransition(async () => {
                await saveUiPref("ui_theme", e.target.value);
                router.refresh();
              })
            }
            className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
          >
            <option value="stigma">{t("Stigma — тёмный фиолетовый", "Stigma — dark violet")}</option>
            <option value="vault">{t("Vault — графит и янтарь", "Vault — graphite & amber")}</option>
          </select>
        </label>
      </div>
      <FullscreenCard />

      <SectionLabel>{t("Модели", "Models")}</SectionLabel>
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-ink-700 p-3.5">
        <label className="flex flex-col gap-1">
          <span className="section-label">
            {t("Модель для простых запросов", "Model for simple tasks")}
          </span>
          <select
            value={simpleModel}
            onChange={(e) =>
              startTransition(async () => {
                await saveSimpleModel(e.target.value);
                toast(t("Модель сохранена", "Model saved"));
              })
            }
            className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
          >
            {SIMPLE_LLM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {t(m.hint, m.hintEn)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] leading-relaxed text-t400">
          {t(
            "Используется для корректировки шотов (переделка группы по замечанию), подбора режиссёрских приёмов и анализа референсов в библии. DeepSeek требует DEEPSEEK_API_KEY в .env.local и не видит изображения — анализ картинок в этом случае автоматически идёт через Haiku 4.5. Gemini использует GEMINI_API_KEY (бесплатный тир Google).",
            "Used for shot group rework, director technique picking and bible reference analysis. DeepSeek needs DEEPSEEK_API_KEY in .env.local and has no vision — image analysis falls back to Haiku 4.5. Gemini uses GEMINI_API_KEY (Google free tier).",
          )}
        </p>
      </div>

      <SectionLabel>{t("Генерация видео (Higgsfield)", "Video generation (Higgsfield)")}</SectionLabel>
      <HiggsfieldConnect connected={hfConnected} />

      <SectionLabel>{t("Генерация видео (Kling)", "Video generation (Kling)")}</SectionLabel>
      <KlingConnect connected={klingConnected} />

      <SectionLabel>{t("Шаблоны промптов", "Prompt templates")}</SectionLabel>
      <TemplateEditor
        settingKey="tpl_breakdown"
        title={t("Шаблон разбивки сюжета на шоты (Claude)", "Story-to-shots breakdown template (Claude)")}
        hint={t(
          "Кнопка «Разбить на группы шотов» на вкладке «Сюжет». Плейсхолдеры: {{STORY}} (или [ВСТАВИТЬ ТЕКСТ]) — литературный сюжет; {{DURATION}} — диапазон хронометража с бегунка на вкладке «Сюжет» (например «3–5 минут»). JSON-формат ответа приложение добавляет само.",
          "The Break into shot groups button on the Story tab. Placeholders: {{STORY}} (or [ВСТАВИТЬ ТЕКСТ]) is the literary story; {{DURATION}} is the duration range from the slider on the Story tab (e.g. “3–5 минут”). The JSON response format is appended automatically.",
        )}
        initial={breakdownTemplate}
      />
      <TemplateEditor
        settingKey="tpl_storyboard"
        title={t("Шаблон раскадровки (Nano Banana)", "Storyboard template (Nano Banana)")}
        hint={t(
          "Плейсхолдеры: {{GRID}}, {{PANELS}}, {{REFERENCES}}, {{STORY}}, {{PANEL_STRUCTURE}} — подставляются при сборке на вкладке «Раскадровка».",
          "Placeholders: {{GRID}}, {{PANELS}}, {{REFERENCES}}, {{STORY}}, {{PANEL_STRUCTURE}} — filled when assembling on the Storyboard tab.",
        )}
        initial={storyboardTemplate}
      />
      <TemplateEditor
        settingKey="tpl_video"
        title={t("Шаблон видео-промпта (системный для Claude)", "Video prompt template (Claude system prompt)")}
        hint={t(
          "Инструкция, по которой промпт-фабрика пишет мультишот-промпты для Seedance/Kling. Кнопка «Сгенерировать промпт» на карточке шота.",
          "The instruction the prompt factory follows to write multi-shot prompts for Seedance/Kling. The Generate prompt button on the shot card.",
        )}
        initial={videoTemplate}
      />

      <SectionLabel
        right={
          <span className="flex items-center gap-3">
            {techniques.length > 0 && (
              <ConfirmButton
                action={deleteAllTechniques}
                label={t("удалить все", "delete all")}
                confirmLabel={t(`Удалить все приёмы (${techniques.length})?`, `Delete all techniques (${techniques.length})?`)}
                doneToast={t("Приёмы удалены", "Techniques deleted")}
                className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-t400 hover:text-danger disabled:opacity-50"
                armedClassName="text-danger"
              />
            )}
            <button
              onClick={openNew}
              className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-violet-200 hover:text-violet-100"
            >
              {t("+ Добавить приём", "+ Add technique")}
            </button>
          </span>
        }
      >
        {t("Режиссёрские приёмы", "Director techniques")} · {techniques.length}
      </SectionLabel>
      <div className="text-[10.5px] leading-relaxed text-t400">
        <span className="text-violet-600">✦</span>&nbsp;{" "}
        {t(
          "Промпт-фабрика сама подбирает подходящие приёмы к каждому шоту и вплетает их в видео-промпт. Использованные приёмы видны бейджами 🎥 под промптом шота.",
          "The prompt factory picks fitting techniques for each shot and weaves them into the video prompt. Used techniques show as 🎥 badges under the shot prompt.",
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={t("Поиск по названию, тегам, тексту…", "Search by title, tags, text…")}
          className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[12px] text-t200 outline-none focus:border-[var(--border-strong)]"
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(PAGE);
          }}
          className="min-h-10 rounded-lg border border-[var(--border-default)] bg-ink-600 px-2 text-[11.5px] text-t100 outline-none"
        >
          <option value="">{t("Все категории", "All categories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        {filtered.slice(0, limit).map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t)}
            className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 py-2.5 text-left hover:border-[var(--border-strong)]"
          >
            <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-ink-600 text-[13px]">
              🎥
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-t100">{t.title}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-t400">
                {t.category}
                {t.camera ? ` · ${t.camera}` : ""}
                {t.custom ? ` · ${tr("свой", "custom")}` : ""}
              </span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-[11px] text-t400">
            {t("Ничего не найдено", "Nothing found")}
          </div>
        )}
        {filtered.length > limit && (
          <button
            onClick={() => setLimit((v) => v + PAGE)}
            className="min-h-10 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t300 hover:bg-ink-600"
          >
            {t(`Показать ещё (${filtered.length - limit})`, `Show more (${filtered.length - limit})`)}
          </button>
        )}
      </div>

      {/* Просмотр приёма */}
      <Sheet open={Boolean(selected) && !editing} onClose={() => setSelected(null)} title={selected?.title ?? ""}>
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {[selected.category, selected.camera, selected.lens, selected.lighting]
                .filter(Boolean)
                .map((m) => (
                  <span
                    key={m}
                    className="rounded border border-[var(--border-subtle)] bg-ink-600 px-2 py-1 font-mono text-[9.5px] text-t300"
                  >
                    {m}
                  </span>
                ))}
            </div>
            {selected.tags && (
              <div className="font-mono text-[10px] text-t400">#{selected.tags.split(",").map((t) => t.trim()).join(" #")}</div>
            )}
            <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[11px] leading-relaxed text-t200">
              {selected.prompt}
            </div>
            {selected.negative && (
              <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-ink-800 p-3 font-mono text-[10px] leading-relaxed text-t400">
                negative: {selected.negative}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => openEdit(selected)}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-semibold text-t200 hover:bg-ink-500"
              >
                {t("✎ Править", "✎ Edit")}
              </button>
              <ConfirmButton
                action={async () => {
                  await deleteTechnique(selected.id);
                  setSelected(null);
                }}
                label={t("Удалить", "Delete")}
                confirmLabel={t("Точно удалить приём?", "Really delete this technique?")}
                doneToast={t("Приём удалён", "Technique deleted")}
                className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] px-3 text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)] disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </Sheet>

      {/* Редактирование / создание приёма */}
      <Sheet
        open={editing}
        onClose={() => {
          setEditing(false);
          setDraft(null);
        }}
        title={draft?.id ? t("Правка приёма", "Edit technique") : t("Новый приём", "New technique")}
      >
        {draft && (
          <div className="flex flex-col gap-2 pb-2">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("Название приёма", "Technique title")}
              className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[13px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
            />
            <div className="flex gap-2">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder={t("Категория", "Category")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
              <input
                value={draft.camera}
                onChange={(e) => setDraft({ ...draft, camera: e.target.value })}
                placeholder={t("Камера (напр. Steadicam)", "Camera (e.g. Steadicam)")}
                className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 text-[11.5px] text-t200 outline-none focus:border-[var(--border-strong)]"
              />
            </div>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder={t("Теги через запятую (one-take, chase…)", "Comma-separated tags (one-take, chase…)")}
              className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 font-mono text-[11px] text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={7}
              placeholder={t("Текст приёма (английский промпт)…", "Technique text (English prompt)…")}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
            />
            <textarea
              value={draft.negative}
              onChange={(e) => setDraft({ ...draft, negative: e.target.value })}
              rows={3}
              placeholder={t("Negative prompt (по желанию)…", "Negative prompt (optional)…")}
              className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-800 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-t400 outline-none focus:border-[var(--border-strong)]"
            />
            <button
              onClick={submitDraft}
              disabled={pending || !draft.title.trim() || !draft.prompt.trim()}
              className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.12em] text-white hover:bg-violet-400 disabled:opacity-50"
              style={{ boxShadow: "var(--glow-violet-sm)" }}
            >
              {pending ? t("Сохранение…", "Saving…") : t("Сохранить приём", "Save technique")}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
