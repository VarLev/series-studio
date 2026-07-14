/**
 * Анализ референсов шота (стартовый кадр / композиция / layout): один раз на
 * загрузке vision-модель описывает картинку, и описание КЭШИРУЕТСЯ за файлом
 * (references.analysis, ключ — storage_path). Открепление/повторное прикрепление
 * референса НЕ перезапускает анализ: attach копирует строку с тем же storage_path,
 * а ensureReferenceAnalysis сперва ищет уже готовый анализ у «братьев» по файлу и
 * копирует его без нового вызова модели. Описание уходит в Enhance/Rework и в
 * промпт-фабрику (роль применяется там: стартовый кадр → первый шот строго по
 * описанию; layout → геометрия/расстановка; композиция → кадрирование/свет/тон).
 */
import { eq } from "drizzle-orm";
import { getDb, references } from "@/lib/db";
import { llmAnalyzeShotReference } from "@/lib/llm/factory";
import type { ReferenceAnalysis } from "@/lib/llm/contracts";

// чистые помощники разбора вынесены в lib/refAnalysis (без серверных зависимостей),
// чтобы промпт-фабрика импортировала их без цикла; ре-экспорт для совместимости
export { parseRefAnalysis, refAnalysisText, type RefAnalysis } from "./refAnalysis";

// Один файл — один живой vision-вызов. Триггеры анализа независимые (фон
// загрузки, attach, слайдер деталей, бэкофилл Enhance/Rework), и пока поле
// пустое, каждый из них звал модель заново — реальный инцидент: >10 одинаковых
// задач Gemini на один референс. Параллельные вызовы теперь ждут общий промис.
// globalThis — чтобы карта переживала HMR-пересборку модуля в dev.
const g = globalThis as unknown as { __refAnalysisInflight?: Map<string, Promise<void>> };
const inflight = (g.__refAnalysisInflight ??= new Map<string, Promise<void>>());

/**
 * Гарантирует, что у референса есть анализ. Порядок: (1) уже есть — выходим;
 * (2) есть у другого референса того же файла — копируем без вызова модели (кэш);
 * (3) тот же файл уже анализируется — ждём чужой вызов и забираем его результат;
 * (4) иначе зовём vision-модель и раскладываем результат по ВСЕМ строкам этого
 * файла (storage_path), чтобы будущие копии получали кэш-хит. Ошибка модели не
 * бросается наверх — поле остаётся пустым и повторится по требованию.
 */
export async function ensureReferenceAnalysis(refId: string): Promise<void> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return;
  if (ref.analysis?.trim()) return; // уже проанализирован

  // кэш по файлу: другой референс того же storage_path уже разобран → копируем
  const copyFromSiblings = async (): Promise<boolean> => {
    const siblings = await db
      .select()
      .from(references)
      .where(eq(references.storagePath, ref.storagePath));
    const cached = siblings.find((s) => s.analysis?.trim());
    if (!cached) return false;
    await db
      .update(references)
      .set({ analysis: cached.analysis })
      .where(eq(references.id, refId));
    return true;
  };
  if (await copyFromSiblings()) return;

  // файл уже анализируется параллельным триггером — ждём его и берём кэш
  const running = inflight.get(ref.storagePath);
  if (running) {
    await running.catch(() => {});
    await copyFromSiblings();
    return;
  }

  // нового анализа ещё нет нигде — реальный vision-вызов
  const task = (async () => {
    const result: ReferenceAnalysis = await llmAnalyzeShotReference(refId);
    const text = JSON.stringify({
      description: result.description ?? "",
      camera: result.camera ?? "",
    });
    // раскладываем по всем строкам этого файла — реаттач получит готовый анализ
    await db
      .update(references)
      .set({ analysis: text })
      .where(eq(references.storagePath, ref.storagePath));
  })();
  inflight.set(ref.storagePath, task);
  try {
    await task;
  } catch (err) {
    console.error("reference analysis failed:", err);
    // оставляем пустым — подхватится по требованию (слайдер / Enhance / Rework)
  } finally {
    inflight.delete(ref.storagePath);
  }
}

/** Догоняет анализ для всех референсов шота (бэкофилл перед Enhance/Rework). */
export async function ensureShotRefsAnalyzed(shotId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(references).where(eq(references.shotId, shotId));
  for (const r of rows) {
    if (!r.analysis?.trim()) await ensureReferenceAnalysis(r.id);
  }
}
