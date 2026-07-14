"use client";

import { useRef, useState, useTransition } from "react";
import {
  updateEntity,
  setEntityArchived,
  deleteEntity,
  analyzeEntityReference,
  getEntityFields,
  type EntityType,
} from "@/lib/actions/entities";
import { useLongAction } from "@/components/useLongAction";
import { normalizeElementName } from "@/lib/entityName";
import { SectionLabel } from "@/components/ui";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

interface Fields {
  name: string;
  elementName: string;
  description: string;
  wardrobe: string;
  type: string;
}

export default function EntityForm({
  entity,
  mainRefId = null,
}: {
  entity: {
    id: string;
    type: string;
    name: string;
    elementName: string;
    description: string;
    wardrobe: string;
    soulId: string;
    archived: boolean;
  };
  /** основной референс (первый) — его анализирует кнопка «Анализ» */
  mainRefId?: string | null;
}) {
  const t = useT();
  // сохранение только по кнопке Save (замечание заказчика) — правки живут
  // локально, dirty сравнивается со снимком последнего сохранённого состояния
  const initial: Fields = {
    name: entity.name,
    // element_name всегда с ведущим @ (нормализуем старые значения без @)
    elementName: normalizeElementName(entity.elementName),
    description: entity.description,
    wardrobe: entity.wardrobe,
    type: entity.type,
  };
  const [fields, setFields] = useState<Fields>(initial);
  const [saved, setSaved] = useState<Fields>(initial);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  // анализ — долгий vision-вызов: ответ может потеряться в туннеле, но сервер уже
  // сохранил поля — добираем их поллингом getEntityFields (useLongAction)
  const analyzeAct = useLongAction<{
    name: string;
    description: string;
    wardrobe: string;
    faceOnly: boolean | null; // null — результат добран поллингом, флаг неизвестен
  }>();
  const startingRef = useRef(false);
  const dirty =
    fields.name !== saved.name ||
    fields.elementName !== saved.elementName ||
    fields.description !== saved.description ||
    fields.wardrobe !== saved.wardrobe ||
    fields.type !== saved.type;

  function save() {
    const snapshot = { ...fields };
    startTransition(async () => {
      await updateEntity(entity.id, {
        name: snapshot.name,
        elementName: snapshot.elementName,
        description: snapshot.description,
        wardrobe: snapshot.wardrobe,
        type: snapshot.type as EntityType,
      });
      setSaved(snapshot);
      toast(t("Сущность сохранена", "Entity saved"));
    });
  }

  /** Применить результат анализа к полям и снимку (общий финиш обоих путей). */
  function applyAnalysis(v: { name: string; description: string; wardrobe: string; faceOnly: boolean | null }) {
    // сервер уже сохранил значения — синхронизируем поля и снимок
    // (имя, описание и гардероб; подписи референсов правятся в БД → галерея)
    setFields((f) => {
      const next = {
        ...f,
        name: v.name || f.name,
        description: v.description || f.description,
        wardrobe: v.wardrobe || f.wardrobe,
      };
      setSaved((s) => ({
        ...s,
        name: v.name || s.name,
        description: v.description || s.description,
        wardrobe: v.wardrobe || s.wardrobe,
      }));
      return next;
    });
    toast(
      v.faceOnly
        ? t("Анализ готов · референс помечен «только лицо»", "Analyzed · reference marked face-only")
        : t("Анализ готов — все поля переведены на английский", "Analyzed — all fields translated to English"),
    );
  }

  /** Анализ основного референса: vision-модель заполняет описание и гардероб. */
  async function analyze() {
    if (!mainRefId) return;
    // защита от двойного тапа: до start есть await за снимком, busy ещё false
    if (startingRef.current || analyzeAct.busy) return;
    startingRef.current = true;
    // снимок «до» с сервера: поллинг ловит момент, когда анализ изменил поля в БД
    const before = await getEntityFields(entity.id).catch(() => null);
    startingRef.current = false;
    analyzeAct.start({
      run: async () => {
        const res = await analyzeEntityReference(mainRefId);
        return res.ok ? { ok: true, value: { ...res, faceOnly: res.faceOnly } } : res;
      },
      poll: before
        ? async () => {
            const f = await getEntityFields(entity.id);
            if (!f) return null;
            const changed =
              f.name !== before.name ||
              f.description !== before.description ||
              f.wardrobe !== before.wardrobe;
            return changed ? { ok: true, value: { ...f, faceOnly: null } } : null;
          }
        : undefined,
      pollMs: 5000,
      ceilingSec: 180,
      ceilingMsg: t(
        "Ответа нет дольше 3 минут. Анализ мог сохраниться — обновите страницу.",
        "No response for over 3 minutes. The analysis may have been saved — reload the page.",
      ),
      onOk: applyAnalysis,
      onErr: (msg) => toast(msg),
    });
  }

  async function copyElement() {
    await navigator.clipboard.writeText(fields.elementName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SectionLabel>{t("Имя", "Name")}</SectionLabel>
        <input
          value={fields.name}
          onChange={(e) => setFields({ ...fields, name: e.target.value })}
          className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-ink-700 px-3 text-[14px] font-semibold text-t100 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel hint={t("всегда с @, подставляется в промпты", "always @-prefixed, inserted into prompts")}>
          element_name
        </SectionLabel>
        <div className="flex gap-2">
          {/* @ — фиксированный префикс: сущности библии всегда начинаются с @ */}
          <div className="flex min-h-11 flex-1 items-center rounded-lg border border-[var(--border-subtle)] bg-ink-700 pl-3 focus-within:border-[var(--border-strong)]">
            <span className="select-none font-mono text-[13px] font-semibold text-violet-400">@</span>
            <input
              value={fields.elementName.replace(/^@/, "")}
              onChange={(e) =>
                setFields({ ...fields, elementName: normalizeElementName(e.target.value) })
              }
              spellCheck={false}
              className="min-h-11 w-full min-w-0 bg-transparent px-1 font-mono text-[13px] text-violet-200 outline-none"
            />
          </div>
          <button
            onClick={copyElement}
            className="min-h-11 rounded-lg border border-[var(--border-default)] px-4 text-[11px] font-semibold text-t200 hover:bg-ink-500"
          >
            {copied ? "✓" : t("Копировать", "Copy")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <SectionLabel hint={t("краткий якорь · детали задаёт референс", "short anchor · details come from the reference")}>
            {t("Описание", "Description")}
          </SectionLabel>
          <span className="flex-1" />
          {entity.type === "character" && (
            <button
              onClick={analyze}
              disabled={analyzeAct.busy || !mainRefId}
              title={
                mainRefId
                  ? t(
                      "Vision-модель заполнит описание, гардероб и пометку «только лицо» по первому референсу",
                      "Vision model fills description, wardrobe and face-only flag from the first reference",
                    )
                  : t("Сначала загрузите референс", "Upload a reference first")
              }
              className="min-h-8 rounded-md border border-[var(--border-default)] px-2.5 text-[10.5px] font-semibold text-violet-200 hover:border-[var(--border-strong)] hover:bg-ink-600 disabled:opacity-50"
            >
              {analyzeAct.busy
                ? t(`Анализ… ${analyzeAct.elapsed}с`, `Analyzing… ${analyzeAct.elapsed}s`)
                : t("✨ Анализ", "✨ Analyze")}
            </button>
          )}
        </div>
        <textarea
          value={fields.description}
          onChange={(e) => setFields({ ...fields, description: e.target.value })}
          rows={2}
          placeholder={t(
            "Короткий якорь: пол, возраст, 2–3 приметы. Полное описание не нужно — облик задаёт референс. У кого есть полноценный референс, внешность в промпт вообще не отправляется.",
            "Short anchor: gender, age, 2–3 traits. No full description — the reference carries the look. For characters with a full reference, appearance isn't sent to the prompt at all.",
          )}
          className="resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 text-[13px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      {entity.type === "character" && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel
            hint={t(
              "на английском · применяется даже с «только лицо»",
              "in English · applied even with face-only",
            )}
          >
            {t("Гардероб (базовый)", "Wardrobe (base)")}
          </SectionLabel>
          <textarea
            value={fields.wardrobe}
            onChange={(e) => setFields({ ...fields, wardrobe: e.target.value })}
            rows={2}
            spellCheck={false}
            placeholder={t(
              "charcoal wool coat over white shirt, black jeans — одежда по умолчанию, если у группы не задан свой наряд",
              "charcoal wool coat over white shirt, black jeans — default outfit unless a group sets its own",
            )}
            className="resize-y rounded-lg border border-[var(--border-subtle)] bg-ink-700 p-3 font-mono text-[12px] leading-relaxed text-t200 outline-none focus:border-[var(--border-strong)]"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <select
          value={fields.type}
          onChange={(e) => setFields({ ...fields, type: e.target.value })}
          className="min-h-10 rounded-md border border-[var(--border-default)] bg-ink-600 px-2 text-[12px] text-t100 outline-none"
        >
          <option value="character">{t("Персонаж", "Character")}</option>
          <option value="location">{t("Локация", "Location")}</option>
          <option value="prop">{t("Реквизит", "Prop")}</option>
          <option value="style">{t("Стиль", "Style")}</option>
        </select>
        <span className="flex-1" />
        <button
          onClick={() => startTransition(() => setEntityArchived(entity.id, !entity.archived))}
          className="min-h-10 rounded-md border border-[var(--border-subtle)] px-3 text-[11px] text-t300 hover:text-t100"
        >
          {entity.archived ? t("Вернуть из архива", "Unarchive") : t("В архив", "Archive")}
        </button>
      </div>

      <button
        onClick={save}
        disabled={pending || !dirty}
        className="min-h-12 w-full rounded-lg bg-violet-500 text-[11px] font-semibold uppercase tracking-[0.14em] text-white hover:bg-violet-400 disabled:opacity-50"
        style={{ boxShadow: dirty ? "var(--glow-violet-sm)" : "none" }}
      >
        {pending
          ? t("Сохранение…", "Saving…")
          : dirty
            ? t("Сохранить", "Save")
            : t("Сохранено", "Saved")}
      </button>

      {/* spec §2.7: удаление — пропадает из библии и из чипов шотов */}
      <button
        onClick={() => {
          if (confirmDelete) startTransition(() => deleteEntity(entity.id));
          else setConfirmDelete(true);
        }}
        className="min-h-10 rounded-lg border border-[rgba(194,71,106,.4)] text-[11px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
      >
        {confirmDelete
          ? t("Точно удалить? (пропадёт из чипов шотов)", "Really delete? (disappears from shot chips)")
          : t("Удалить сущность", "Delete entity")}
      </button>
    </div>
  );
}
