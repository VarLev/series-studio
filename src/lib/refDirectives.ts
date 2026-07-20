/**
 * Строки-директивы референса группы в тексте видео-промпта.
 *
 * Начальные строки промпта зависят от роли референса шота (стартовый кадр /
 * композиция / layout) и от трека (Kling → @Start, Seedance → @Image1). Их
 * формирует модель при генерации промпта (см. startFrameBlock/compLines в
 * factory.ts) — эту функциональность мы НЕ убираем. Но чтобы не перегенерировать
 * промпт при каждой смене референса, здесь же лежит автоматическая синхронизация:
 * при добавлении/удалении/смене типа референса строки переписываются программно
 * (reconcileShotPromptRefs) без обращения к модели.
 *
 * Единый источник истины: те же строки используются и в инструкции модели
 * (factory.ts), и в авто-синхронизации — чтобы после ручной смены типа строки
 * выглядели ровно так же, как сгенерировала бы модель.
 *
 * Опознавание строк-директив — по якорям @Start / @Image1 / @CompN, которые по
 * договорённости встречаются ТОЛЬКО в этих строках (в остальном тексте промпта
 * их нет). Идентити-строки персонажей (@ElementName) под это НЕ попадают.
 */
import { asc, desc, eq } from "drizzle-orm";
import { getDb, prompts, references, shots } from "@/lib/db";
import { promptFamily, type PromptFamily } from "@/lib/llm/models";

/** Якорь стартового кадра в тексте промпта конкретного трека. */
export function startFrameAnchor(family: PromptFamily): "@Start" | "@Image1" {
  return family === "kling" ? "@Start" : "@Image1";
}

/** Каноничная строка стартового кадра. */
export function startFrameLine(family: PromptFamily): string {
  return `Use ${startFrameAnchor(family)} as the locked starting frame.`;
}

/** Каноничная строка референса-композиции для якоря @CompN. */
export function compositionLine(anchor: string): string {
  return `Use ${anchor} ONLY as composition and blocking reference.`;
}

/** Каноничная строка референса-layout для якоря @CompN. */
export function layoutLine(anchor: string): string {
  // «never render …» — запрет материализовать layout-референс в собственный кадр:
  // видеомодель вставляла его широким мастер-планом ПОВЕРХ заявленной нарезки
  // (инцидент 2026-07-18: 6 катов вместо 5, лишний wide между SHOT 04 и 05)
  return (
    `Use ${anchor} ONLY to establish the room layout and where characters and objects are ` +
    `positioned (spatial relationships). Do NOT copy ${anchor}'s camera angle or visible framing — ` +
    `the shots use new camera positions. Never render ${anchor}'s view as a shot of its own.`
  );
}

/**
 * Хвост «закреплён за шотом» для референса, привязанного к конкретному шоту
 * группы (beats[].ref_ids, drag-and-drop миниатюры). Единый текст для
 * промпт-фабрики (factory.ts) и авто-синка ниже. Формулировка зависит от РОЛИ:
 *  - composition → раскадровочный кадр шота («storyboard frame» — так привязку
 *    к шоту формулируют гайды Seedance 2.0): точный вид/ракурс именно этого шота;
 *  - layout → только геометрия пространства ЭТОГО шота; запрет копировать ракурс
 *    из самой layout-строки сохраняется — иначе суффикс противоречил бы ей.
 */
export function beatPinSuffix(orders: number[], role?: string | null): string {
  const list = [...orders]
    .sort((a, b) => a - b)
    .map((o) => `SHOT ${String(o).padStart(2, "0")}`)
    .join(" and ");
  return role === "layout"
    ? ` This layout reference applies ONLY to ${list}: use its room geometry and character/object ` +
        `positions for that shot alone (still do NOT copy its camera angle), and ignore it in the other shots.`
    : ` This reference is the storyboard frame for ${list} — match its composition, camera angle ` +
        `and framing exactly in that shot, and ONLY in that shot; never apply it to the other shots.`;
}

export interface DirectiveRef {
  role: "start_frame" | "composition" | "layout" | string | null;
  /** order'ы шотов группы, за которыми референс закреплён (beats[].ref_ids); пусто → групповой */
  beatOrders?: number[];
}

/**
 * Полный набор строк-директив для текущего состояния референсов шота.
 * refs — референсы шота, УЖЕ отсортированные по createdAt (тот же порядок, что
 * даёт якорям @Comp1..N generation.ts и страница шота). Стартовый кадр — первым.
 */
export function referenceDirectiveLines(refs: DirectiveRef[], family: PromptFamily): string[] {
  const lines: string[] = [];
  if (refs.some((r) => r.role === "start_frame")) lines.push(startFrameLine(family));
  const attached = refs.filter((r) => r.role !== "start_frame");
  attached.forEach((r, i) => {
    const anchor = `@Comp${i + 1}`;
    const base = r.role === "layout" ? layoutLine(anchor) : compositionLine(anchor);
    lines.push(r.beatOrders?.length ? base + beatPinSuffix(r.beatOrders, r.role) : base);
  });
  return lines;
}

// якоря управляемых нами строк-директив (только референсы шота; @ElementName
// персонажей и локаций сюда НЕ попадают)
const REF_ANCHOR_RE = /@(?:Comp\d+|Start|Image1)\b/i;

// вольные упоминания стартового кадра БЕЗ якоря, которые модель раскидывает по телу
// промпта (напр. «Match starting frame composition exactly …», «continues from the
// starting frame»). Формулировки разные — общий устойчивый признак — «start(ing) frame»,
// который в видео-промпте появляется только когда подразумевается стартовый кадр.
const START_FRAME_MENTION_RE = /\bstart(?:ing)?[ -]?frame\b/i;

/** Есть ли в тексте строки-директивы референса (по якорям). */
export function hasReferenceDirectives(text: string): boolean {
  return text.split(/\r?\n/).some((l) => REF_ANCHOR_RE.test(l));
}

/**
 * Вычищает вольные упоминания стартового кадра из тела промпта — на случай, когда
 * стартового кадра БОЛЬШЕ НЕТ (сменили тип на композицию/layout или открепили), а
 * модель оставила по тексту фразы вроде «Match starting frame composition exactly».
 *
 * Режем ПОСЕНТЕНСНО: строку делим на предложения по .!? (тире/точку-с-запятой
 * границей НЕ считаем — иначе от «… exactly — same angle, same light.» остался бы
 * обрывок) и выкидываем ТОЛЬКО предложения с упоминанием стартового кадра. Если
 * строка целиком была про стартовый кадр — она исчезает. Идемпотентно.
 */
export function stripStartFrameMentions(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!START_FRAME_MENTION_RE.test(line)) {
      out.push(line); // строки без упоминания (в т.ч. пустые) — как есть
      continue;
    }
    const kept = line
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !START_FRAME_MENTION_RE.test(s))
      .join(" ")
      .trim();
    if (kept) out.push(kept); // пусто → строка была целиком про стартовый кадр, убираем
  }
  // схлопываем тройные пустые строки, которые могли появиться после вырезания
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Переписывает строки-директивы референса в тексте промпта под текущее состояние
 * refs, не трогая остальной промпт. Старые строки-директивы (по якорям) вырезаются,
 * новые вставляются на их место (а при первом добавлении — в начало). Идемпотентно.
 */
export function applyReferenceDirectives(
  text: string,
  refs: DirectiveRef[],
  family: PromptFamily,
): string {
  const desired = referenceDirectiveLines(refs, family);
  const hasStart = refs.some((r) => r.role === "start_frame");
  const lines = text.split(/\r?\n/);
  const firstAnchorIdx = lines.findIndex((l) => REF_ANCHOR_RE.test(l));
  const hadAnchor = firstAnchorIdx >= 0;

  // 1) реконсиляция строк-директив по якорю → result
  let result: string;
  if (!hadAnchor && desired.length === 0) {
    result = text;
  } else {
    const kept = lines.filter((l) => !REF_ANCHOR_RE.test(l));
    if (desired.length === 0) {
      // референсов не осталось — просто вырезаем строки-директивы
      result = kept.join("\n");
    } else {
      // вставляем на позицию, где были старые директивы (сохраняем возможный заголовок
      // над ними); при первом добавлении — в самое начало
      const insertAt = hadAnchor
        ? lines.slice(0, firstAnchorIdx).filter((l) => !REF_ANCHOR_RE.test(l)).length
        : 0;
      result = [...kept.slice(0, insertAt), ...desired, ...kept.slice(insertAt)].join("\n");
    }
  }

  // 2) стартового кадра больше нет → дочищаем вольные упоминания стартового кадра
  // из тела промпта (без якоря). Каноничные строки composition/layout слово
  // «starting frame» не содержат, поэтому под нож не попадают.
  return hasStart ? result : stripStartFrameMentions(result);
}

/**
 * Авто-синхронизация строк-директив во ВСЕХ актуальных промптах шота (последняя
 * версия каждого трека) под текущее состояние референсов. Вызывается после
 * добавления/удаления/смены роли референса — без обращения к модели. Пишет только
 * изменившиеся версии.
 */
export async function reconcileShotPromptRefs(shotId: string): Promise<void> {
  const db = await getDb();
  const refRows = await db
    .select({ id: references.id, role: references.role, createdAt: references.createdAt })
    .from(references)
    .where(eq(references.shotId, shotId))
    .orderBy(asc(references.createdAt));

  // beat-привязки (beats[].ref_ids): строка закреплённого референса получает тот же
  // суффикс «pinned to SHOT N», что пишет промпт-фабрика — синк не затирает привязку
  const [shotRow] = await db
    .select({ beatsJson: shots.beatsJson })
    .from(shots)
    .where(eq(shots.id, shotId));
  const ordersByRefId = new Map<string, number[]>();
  try {
    const beats = JSON.parse(shotRow?.beatsJson || "[]") as Array<{
      order: number;
      ref_ids?: string[];
    }>;
    if (Array.isArray(beats)) {
      for (const b of beats) {
        for (const rid of b.ref_ids ?? []) {
          ordersByRefId.set(rid, [...(ordersByRefId.get(rid) ?? []), b.order]);
        }
      }
    }
  } catch {}
  const refs: DirectiveRef[] = refRows.map((r) => ({
    role: r.role,
    beatOrders: ordersByRefId.get(r.id),
  }));

  const promptRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));

  // только последняя версия каждого трека (её берут на генерацию)
  const seen = new Set<PromptFamily>();
  for (const p of promptRows) {
    const fam = promptFamily(p.targetModel);
    if (seen.has(fam)) continue;
    seen.add(fam);
    const next = applyReferenceDirectives(p.text, refs, fam);
    if (next !== p.text) {
      await db.update(prompts).set({ text: next }).where(eq(prompts.id, p.id));
    }
  }
}
