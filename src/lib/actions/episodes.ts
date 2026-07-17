"use server";

import { asc, desc, eq, sql as dsql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, episodes, settings, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { llmBreakdown } from "@/lib/llm/factory";
import { setSetting } from "@/lib/settings";
import { composeActionMd, normalizeBeats, recomputeEpisodeTimecodes } from "@/lib/beats";
import { buildEntityLinkIndex, linkGroupEntities, type EntityLinkIndex } from "@/lib/entityLink";
import { stripAt } from "@/lib/entityName";
import type { Breakdown } from "@/lib/llm/contracts";

/**
 * Эпизод создаётся ТОЛЬКО когда в черновике появился текст (замечание заказчика:
 * пустая кнопка «Новая серия» плодила пустые эпизоды). Экран /episodes/new
 * держит черновик локально и зовёт это действие при первом непустом вводе.
 */
export async function createEpisodeFromDraft(input: {
  title?: string;
  logline?: string;
  synopsisMd?: string;
}): Promise<string> {
  await requireAuth();
  const db = await getDb();
  const [last] = await db.select().from(episodes).orderBy(desc(episodes.number)).limit(1);
  const id = crypto.randomUUID();
  await db.insert(episodes).values({
    id,
    number: (last?.number ?? 0) + 1,
    title: input.title ?? "",
    logline: input.logline ?? "",
    synopsisMd: input.synopsisMd ?? "",
  });
  revalidatePath("/episodes");
  return id;
}

export async function updateEpisode(
  id: string,
  patch: { title?: string; logline?: string; synopsisMd?: string; status?: string },
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(episodes).set(patch).where(eq(episodes.id, id));
  revalidatePath(`/episodes/${id}`);
  revalidatePath("/episodes");
}

/** Выбор LLM-модели сохраняется сразу при смене в селекте — переживает вкладки и перезагрузку. */
export async function saveLlmModelChoice(model: string): Promise<void> {
  await requireAuth();
  await setSetting("llm_model", model);
}

// Тайник результата разбивки (самовосстановление через туннель): llmBreakdown идёт
// минуты, ответ экшена часто теряется (trycloudflare ~100 с) — раньше результат
// пропадал вместе с потраченными деньгами. Теперь он кладётся в settings под
// клиентским ТОКЕНОМ запуска, и SynopsisEditor добирает его pollBreakdownResult.
// Токен вместо таймстампа: часы телефона и сервера могут расходиться на минуты.
const bdStashKey = (episodeId: string) => `bd_result:${episodeId}`;

type BdResult = { ok: true; breakdown: Breakdown } | { ok: false; error: string };
type GlobalBdLock = typeof globalThis & { __ssBreakdownInflight?: Map<string, Promise<BdResult>> };

/**
 * Разбивка — самый долгий и самый дорогой вызов платформы (минуты, вся серия
 * разом). Через туннель браузер/Next повторяют такой экшен, пока первый жив —
 * ровно та беда, от которой уже защищён reviseGroup: повтор запускал ВТОРУЮ
 * полную разбивку параллельно с первой, за вторые деньги. Дедуп по токену
 * запуска: повтор ждёт первый вызов, а повтор уже отработавшего токена получает
 * готовый результат из тайника.
 */
export async function breakdownEpisode(
  episodeId: string,
  model?: string,
  duration?: { min: number; max: number },
  /** токен клиента — метит тайник результата именно этого запуска */
  token?: string,
): Promise<BdResult> {
  await requireAuth();
  if (!token) return runBreakdown(episodeId, model, duration, undefined);

  const g = globalThis as GlobalBdLock;
  if (!g.__ssBreakdownInflight) g.__ssBreakdownInflight = new Map();
  const key = `${episodeId}::${token}`;
  const inflight = g.__ssBreakdownInflight.get(key);
  if (inflight) return inflight;
  // тот же токен уже отработал (повтор после ответа) — отдаём сохранённый исход
  const done = await pollBreakdownResult(episodeId, token);
  if (done) return done;

  const work = runBreakdown(episodeId, model, duration, token).finally(() => {
    g.__ssBreakdownInflight!.delete(key);
  });
  g.__ssBreakdownInflight.set(key, work);
  return work;
}

async function runBreakdown(
  episodeId: string,
  model?: string,
  duration?: { min: number; max: number },
  token?: string,
): Promise<BdResult> {
  const stash = async (payload: BdResult) => {
    if (!token) return;
    try {
      // finishedAt метит тайник «новым»: по нему claimBreakdownResult отличает
      // результат, который РЕАЛЬНО никто не забирал, от тайников старых версий,
      // где чистки не было и лежал результат давно утверждённой разбивки
      await setSetting(
        bdStashKey(episodeId),
        JSON.stringify({ token, finishedAt: Date.now(), ...payload }),
      );
    } catch {}
  };
  try {
    if (model) await setSetting("llm_model", model);
    const db = await getDb();
    const [ep] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!ep) return { ok: false, error: "Эпизод не найден" };
    if (!ep.synopsisMd.trim())
      return { ok: false, error: "Сначала вставьте литературный сюжет во вкладке «Сюжет»" };
    const raw = await llmBreakdown(episodeId, ep.synopsisMd, model, duration);
    // ретайминг ДО предпросмотра: пользователь утверждает ровно те цифры, которые
    // сохранятся. Раньше normalizeBeats работал только в saveBreakdown — группа
    // показывала «12 сек» от модели, а создавалась с пересчитанными по формуле
    // речи (и подрезанными до 15), то есть подтверждали одно, получали другое.
    const breakdown = normalizeBreakdown(raw);
    await stash({ ok: true, breakdown });
    return { ok: true, breakdown };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Неизвестная ошибка";
    // ошибку тоже в тайник: клиент, потерявший ответ, покажет её вместо таймаута
    await stash({ ok: false, error });
    return { ok: false, error };
  }
}

/**
 * Прогнать группы через тот же ретайминг, что и сохранение. Идемпотентно
 * (повторная нормализация уже нормализованного даёт то же самое), поэтому
 * saveBreakdown спокойно вызывает его ещё раз — на случай ручных правок в
 * предпросмотре.
 */
function normalizeBreakdown(bd: Breakdown): Breakdown {
  return {
    ...bd,
    groups: [...bd.groups]
      .sort((a, b) => a.order - b.order)
      .map((g, i) => {
        const { beats, durationSec } = normalizeBeats(g.shots, g.duration_sec);
        return { ...g, order: i + 1, shots: beats, duration_sec: durationSec };
      }),
  };
}

/**
 * Поллинг тайника разбивки: вернёт результат (или ошибку) запуска с этим токеном,
 * когда breakdownEpisode его сохранит; null — ещё не готово / чужой запуск.
 */
export async function pollBreakdownResult(
  episodeId: string,
  token: string,
): Promise<{ ok: true; breakdown: Breakdown } | { ok: false; error: string } | null> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, bdStashKey(episodeId)));
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as {
      token?: string;
      ok?: boolean;
      breakdown?: Breakdown;
      error?: string;
    };
    if (parsed.token !== token) return null;
    if (parsed.ok && parsed.breakdown) return { ok: true, breakdown: parsed.breakdown };
    if (parsed.ok === false) return { ok: false, error: parsed.error ?? "Неизвестная ошибка" };
  } catch {}
  return null;
}

/**
 * Забрать НЕВОСТРЕБОВАННУЮ разбивку — ту, что дозрела, пока клиента не было:
 * закрыл вкладку, перезагрузил браузер, открыл эпизод с другого устройства.
 * Токен здесь не спрашиваем: его знал только тот браузер, который запускал, а
 * результат уже оплачен и пропадать не должен.
 *
 * Признак «никто не забрал» — САМО наличие тайника: он живёт ровно до того, как
 * пользователь разберётся с предпросмотром (dropBreakdownStash на «Создать» и на
 * «Отмена»). Тайники старых версий (без finishedAt) не отдаём: там чистки не было,
 * и лежать может результат давно утверждённой разбивки — воскрешать его нельзя.
 * Ошибку тоже не отдаём: показывать «ваша разбивка упала» тому, кто пришёл на
 * экран через час с другого устройства, — только пугать; ошибка доедет поллингом
 * тому, кто запускал.
 */
export async function claimBreakdownResult(
  episodeId: string,
): Promise<{ breakdown: Breakdown } | null> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, bdStashKey(episodeId)));
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as {
      finishedAt?: number;
      ok?: boolean;
      breakdown?: Breakdown;
    };
    if (!parsed.finishedAt) return null;
    if (parsed.ok && parsed.breakdown) return { breakdown: parsed.breakdown };
  } catch {}
  return null;
}

/** Пользователь разобрался с предпросмотром (создал группы или отменил) — тайник больше не нужен. */
export async function dropBreakdownStash(episodeId: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.delete(settings).where(eq(settings.key, bdStashKey(episodeId)));
}

/**
 * Имена персонажей, которых модель назвала, но в библии их нет.
 * Локация в список не идёт — чипы-заготовки только для персонажей.
 */
function unlinkedNames(index: EntityLinkIndex, names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    // сравниваем по ключу (без @, в нижнем регистре), а показываем как есть:
    // чип с именем «simon» вместо «Simon» выглядел бы опечаткой
    const display = (raw ?? "").trim().replace(/^@+/, "").trim();
    if (!display) continue;
    const key = stripAt(display);
    if (index.byName.has(key)) continue;
    if (!out.some((x) => stripAt(x) === key)) out.push(display);
  }
  return out;
}

/**
 * Сценарный наряд — на всю сцену, а не на одну группу. Локация и погода едины
 * по связке ПРОГРАММНО (chainLocation/chainTimeWeather), а одежду промпт лишь
 * ПРОСИТ повторить дословно во всех группах сцены — и если модель заполнила
 * wardrobe в группе 3, а в 4–6 забыла, персонаж переодевался посреди сцены
 * (4–6 откатывались на базовый гардероб библии). Здесь наряд, заданный в любой
 * группе сцены, дозаполняется остальным группам ТОЙ ЖЕ сцены, где он пуст;
 * явно заданный моделью наряд не перетирается, границу сцены не пересекаем
 * (scene_start — это в том числе смена дня/места, где переодевание законно).
 */
function spreadWardrobeOverScenes(
  groups: Breakdown["groups"],
): Array<Array<{ name: string; outfit: string }>> {
  const out = groups.map((g) => g.wardrobe.map((w) => ({ ...w })));
  let sceneStart = 0;
  for (let i = 0; i <= groups.length; i++) {
    const isBoundary = i === groups.length || (i > 0 && groups[i].scene_start);
    if (!isBoundary) continue;
    // сцена = [sceneStart, i): собираем известные наряды и дозаполняем пустые
    const known = new Map<string, string>();
    for (let j = sceneStart; j < i; j++) {
      for (const w of out[j]) {
        const outfit = (w.outfit ?? "").trim();
        if (outfit && !known.has(stripAt(w.name))) known.set(stripAt(w.name), outfit);
      }
    }
    if (known.size) {
      for (let j = sceneStart; j < i; j++) {
        const byName = new Map(out[j].map((w) => [stripAt(w.name), w]));
        for (const [name, outfit] of known) {
          const existing = byName.get(name);
          if (!existing) out[j].push({ name, outfit });
          else if (!(existing.outfit ?? "").trim()) existing.outfit = outfit;
        }
      }
    }
    sceneStart = i;
  }
  return out;
}

/**
 * Пользователь подтвердил предпросмотр раскадровки → создаём карточки групп.
 * Spec §2.2: повторный запуск НЕ дублирует готовые группы — по умолчанию новые
 * группы добавляются после существующих (mode="append"); mode="replace" —
 * явная пересборка с нуля.
 */
export async function saveBreakdown(
  episodeId: string,
  breakdown: Breakdown,
  mode: "append" | "replace" = "append",
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  // персонажи/локации из ответа модели → сущности библии: по name и element_name,
  // без учёта @ и регистра + скан текста битов (общий хелпер, см. entityLink.ts)
  const linkIndex = await buildEntityLinkIndex();

  const oldShots = await db.select().from(shots).where(eq(shots.episodeId, episodeId));
  if (mode === "replace") {
    // глубокий каскад: раньше generations (видео) и референсы старых шотов
    // оставались сиротами с мёртвыми ссылками на удалённые шоты
    const { deleteShotDeep } = await import("@/lib/cascade");
    for (const s of oldShots) await deleteShotDeep(s.id);
  }

  const ordered = [...breakdown.groups].sort((a, b) => a.order - b.order);
  const wardrobeByGroup = spreadWardrobeOverScenes(ordered);

  let index =
    mode === "append" ? Math.max(0, ...oldShots.map((s) => s.orderIndex)) + 1 : 1;
  for (const [gi, group] of ordered.entries()) {
    const shotId = crypto.randomUUID();
    // время шотов нормализуется от 00:00 (группа = отдельное видео),
    // сквозной таймкод групп пересчитывается ниже по фактическим длительностям
    const { beats, durationSec } = normalizeBeats(group.shots, group.duration_sec);
    await db.insert(shots).values({
      id: shotId,
      episodeId,
      orderIndex: index++,
      title: group.title,
      durationSec,
      beatsJson: JSON.stringify(beats),
      actionMd: composeActionMd(beats, group.title),
      cameraHint: "",
      location: group.location ?? "",
      timeWeather: group.time_weather ?? "",
      emotionalTone: group.emotional_tone ?? "",
      status: "draft",
      sceneStart: group.scene_start,
      // персонажи, которых модель назвала, но в библии их нет: раньше они молча
      // пропадали (linkGroupEntities связывает только найденных) и всплывали уже
      // на этапе промптов — половина каста без референса. Теперь это красные
      // чипы-заготовки на карточке группы: добавить в библию или снять руками.
      unlinkedCharsJson: JSON.stringify(unlinkedNames(linkIndex, group.characters)),
    });
    await linkGroupEntities(linkIndex, shotId, {
      names: [...group.characters, group.location],
      beatsText: beats
        .map((b) => `${b.framing} ${b.camera} ${b.action} ${b.dialogue}`)
        .join(" "),
      wardrobe: wardrobeByGroup[gi],
    });
  }
  await recomputeEpisodeTimecodes(episodeId);
  await db.update(episodes).set({ status: "storyboarded" }).where(eq(episodes.id, episodeId));
  revalidatePath(`/episodes/${episodeId}`);
}

export async function listEpisodes() {
  await requireAuth();
  const db = await getDb();
  const eps = await db.select().from(episodes).orderBy(asc(episodes.number));
  const counts = await db
    .select({
      episodeId: shots.episodeId,
      total: dsql<number>`count(*)`,
      approved: dsql<number>`sum(case when ${shots.status} = 'approved' then 1 else 0 end)`,
    })
    .from(shots)
    .groupBy(shots.episodeId);
  const byEp = new Map(counts.map((c) => [c.episodeId, c]));
  return eps.map((e) => ({
    ...e,
    shotsTotal: Number(byEp.get(e.id)?.total ?? 0),
    shotsApproved: Number(byEp.get(e.id)?.approved ?? 0),
  }));
}
