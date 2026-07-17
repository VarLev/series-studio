"use client";

/**
 * Настройки: интерфейс, модели, подключения и шаблоны промптов (разбивка сюжета /
 * лист раскадровки / видео). Библиотека режиссёрских приёмов переехала на вкладку
 * «База знаний» — приём это такая же методичка промпт-фабрики, как документ.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import { toast } from "@/components/Toaster";
import {
  saveTemplate,
  resetTemplate,
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

function TemplateEditor({
  settingKey,
  title,
  hint,
  initial,
}: {
  settingKey: "tpl_breakdown" | "tpl_storyboard" | "tpl_video" | "tpl_video_kling";
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
  klingVideoTemplate,
  uiLang,
  uiTheme,
  simpleModel,
  hfConnected,
  klingConnected,
}: {
  breakdownTemplate: string;
  storyboardTemplate: string;
  videoTemplate: string;
  klingVideoTemplate: string;
  uiLang: string;
  uiTheme: string;
  simpleModel: string;
  hfConnected: boolean;
  klingConnected: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [, startTransition] = useTransition();

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
        title={t("Шаблон видео-промпта · Seedance", "Video prompt template · Seedance")}
        hint={t(
          "Инструкция промпт-фабрики для трека Seedance (референсы @Image1/@Start, без нативного звука). Кнопка «Сгенерировать промпт» на карточке шота.",
          "Prompt-factory instruction for the Seedance track (@Image1/@Start references, no native audio). The Generate prompt button on the shot card.",
        )}
        initial={videoTemplate}
      />
      <TemplateEditor
        settingKey="tpl_video_kling"
        title={t("Шаблон видео-промпта · Kling", "Video prompt template · Kling")}
        hint={t(
          "Инструкция промпт-фабрики для трека Kling 3.0 Omni: референсы <<<image_N>>>, нативный звук (реплики в кавычках, эмбиент, SFX), структура «сцена → персонаж → камера → действие → реплика → аудио».",
          "Prompt-factory instruction for the Kling 3.0 Omni track: <<<image_N>>> references, native audio (quoted dialogue, ambience, SFX), “scene → character → camera → action → dialogue → audio” structure.",
        )}
        initial={klingVideoTemplate}
      />

      {/* Библиотека приёмов переехала в «Базу знаний» — оставляем след, чтобы её не искали здесь */}
      <Link
        href="/knowledge"
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-left"
      >
        <span className="text-[13px] leading-none">🎥</span>
        <span className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-t400">
          {t(
            "Режиссёрские приёмы переехали на вкладку «База знаний» — вместе с документами промпт-фабрики.",
            "Director techniques moved to the Knowledge tab — together with the prompt-factory documents.",
          )}
        </span>
        <span className="shrink-0 text-[10px] text-t400">→</span>
      </Link>
    </div>
  );
}
