"use server";

import { desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, entities, generations, prompts, settings, shotEntities, shots } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { llmShotPrompt, llmRevisePrompt } from "@/lib/llm/factory";
import { PROMPT_FAMILIES, promptFamily, type PromptFamily } from "@/lib/llm/models";
import { anchorCharacterNames, collapseAt } from "@/lib/entityName";
import type { ShotPrompt } from "@/lib/llm/contracts";

type Result = { ok: true; promptId: string } | { ok: false; error: string };

/** Конфликт уникального индекса (shot_id, version) — гонка параллельных генераций. */
function isVersionRace(e: unknown): boolean {
  if ((e as { code?: string })?.code === "23505") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("prompts_shot_version_idx");
}

async function insertVersion(
  shotId: string,
  targetModel: string,
  data: ShotPrompt,
  parentId: string | null,
  feedbackNote: string | null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  // персонажи шота: их имена в тексте промпта приводим к якорям @element_name
  // (обычные имена собственные допустимы только в репликах — внутри кавычек)
  const links = await db.select().from(shotEntities).where(eq(shotEntities.shotId, shotId));
  const linkedEntities = links.length
    ? await db.select().from(entities).where(inArray(entities.id, links.map((l) => l.entityId)))
    : [];
  const charList = linkedEntities
    .filter((e) => e.type === "character")
    .map((e) => ({ name: e.name, elementName: e.elementName }));
  const values = {
    id,
    shotId,
    // версия считается ОДНИМ стейтментом со вставкой: раздельные SELECT max + INSERT
    // на параллельных генерациях одного шота (30–200 с, несколько триггеров) читали
    // одинаковый max и чеканили дубли версий, ломая version-based поллеры
    version: sql<number>`(select coalesce(max(p.version), 0) + 1 from prompts p where p.shot_id = ${shotId})`,
    parentId,
    targetModel,
    // имена → якоря @element_name, затем @@Craig → @Craig (модель могла задвоить)
    text: collapseAt(anchorCharacterNames(data.prompt, charList)),
    negativePrompt: data.negative_prompt ? collapseAt(data.negative_prompt) : null,
    paramsJson: JSON.stringify({
      ...data.params,
      reference_element_names: data.reference_element_names,
      techniques: data.used_technique_ids,
    }),
    feedbackNote,
  };
  // подсчёт и вставка всё же не атомарны друг относительно друга под нагрузкой:
  // остаток гонки ловит уникальный индекс (shot_id, version) — тогда просто заново
  for (let attempt = 0; ; attempt++) {
    try {
      await db.insert(prompts).values(values);
      break;
    } catch (e) {
      if (attempt >= 4 || !isVersionRace(e)) throw e;
    }
  }
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot && shot.status === "draft") {
    await db.update(shots).set({ status: "prompted" }).where(eq(shots.id, shotId));
  }
  if (shot) {
    revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
    revalidatePath(`/episodes/${shot.episodeId}`);
  }
  return id;
}

// --- Отмена генерации промпта («эпоха») ------------------------------------
// Каждой генерации промпта клиент присваивает случайную epoch и регистрирует её
// активной для шота. Если задачу отменили ИЛИ запустили новую (epoch сменилась),
// результат старого LLM-вызова в данные НЕ записывается. Сам вызов на сервере
// отозвать нельзя, но его выхлоп отбрасывается ПЕРЕД insertVersion — версия не
// создаётся, на данные он не влияет, а новую задачу можно запустить сразу.
const epochKey = (shotId: string) => `prompt_epoch_${shotId}`;

async function markEpoch(shotId: string, epoch: string): Promise<void> {
  await setSetting(epochKey(shotId), epoch);
}

/** true — задача с этой epoch больше не актуальна (отменена/заменена новой). */
async function epochStale(shotId: string, epoch?: string): Promise<boolean> {
  if (!epoch) return false; // вызов без epoch — прежнее поведение, отмена не нужна
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, epochKey(shotId)));
  return (row?.value ?? epoch) !== epoch;
}

/**
 * Отменить активную генерацию промпта шота: ставим эпоху, которой ни у кого нет,
 * — идущий LLM-вызов при завершении увидит несовпадение и НЕ запишет результат.
 */
export async function cancelPromptGen(shotId: string): Promise<void> {
  await requireAuth();
  await setSetting(epochKey(shotId), `cancelled_${crypto.randomUUID()}`);
}

/**
 * Лёгкий опрос: номер последней версии промпта шота (0 — промпта нет). Клиент
 * поллит его во время генерации, чтобы подхватить результат, даже если ответ
 * долгого запроса потерялся в туннеле (самовосстановление UI). Без ревалидации.
 */
export async function latestPromptVersion(shotId: string): Promise<number> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select({ version: prompts.version })
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Полный список версий трека (Seedance/Kling) в клиентской форме — для кнопки
 * «показать ещё» в истории версий. На страницу шота уезжают только последние ~10
 * версий + текущие каждого трека (экономия пейлоада через туннель); остальные
 * подгружаются этим экшеном по требованию. Без ревалидации.
 */
export async function listPromptVersions(
  shotId: string,
  family: PromptFamily,
): Promise<
  Array<{
    id: string;
    version: number;
    text: string;
    negativePrompt: string;
    targetModel: string;
    feedbackNote: string;
    createdAt: string;
  }>
> {
  await requireAuth();
  const db = await getDb();
  const rows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.shotId, shotId))
    .orderBy(desc(prompts.version));
  return rows
    .filter((v) => promptFamily(v.targetModel) === family)
    .map((v) => ({
      id: v.id,
      version: v.version,
      text: v.text,
      negativePrompt: v.negativePrompt ?? "",
      targetModel: v.targetModel,
      feedbackNote: v.feedbackNote ?? "",
      createdAt: v.createdAt.toISOString(),
    }));
}

/** U2 — сгенерировать промпт шота (промпт-фабрика). llmModel — какая ИИ пишет промпт. */
export async function generateShotPrompt(
  shotId: string,
  targetModel: string,
  llmModel?: string,
  epoch?: string,
  markActive = true,
): Promise<Result> {
  await requireAuth();
  try {
    // markActive=false — вызов из generateShotPromptsFor, эпоха уже помечена там
    // (повторная пометка затёрла бы отмену, пришедшую между треками)
    if (epoch && markActive) await markEpoch(shotId, epoch);
    const data = await llmShotPrompt(shotId, targetModel, llmModel);
    // отменена (или заменена новой задачей) — результат в данные НЕ пишем
    if (await epochStale(shotId, epoch)) return { ok: false, error: "Генерация отменена" };
    const promptId = await insertVersion(shotId, targetModel, data, null, null);
    return { ok: true, promptId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/**
 * Создание промптов по трекам (Seedance / Kling / оба): на каждое выбранное
 * семейство фабрика пишет отдельный промпт по СВОЕМУ шаблону. Последовательно —
 * чтобы не гонять два тяжёлых LLM-вызова параллельно через один аккаунт.
 */
export async function generateShotPromptsFor(
  shotId: string,
  families: PromptFamily[],
  llmModel?: string,
  epoch?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  // всю постановку (оба трека) регистрируем одной эпохой — тогда отмена между
  // треками не теряется (иначе второй трек пометил бы задачу активной заново)
  if (epoch) await markEpoch(shotId, epoch);
  for (const family of families) {
    const meta = PROMPT_FAMILIES.find((f) => f.id === family);
    if (!meta) return { ok: false, error: `Неизвестный трек: ${family}` };
    const res = await generateShotPrompt(shotId, meta.targetModel, llmModel, epoch, false);
    if (!res.ok) {
      return {
        ok: false,
        error: `${meta.label}: ${res.error}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Промпт ТОЛЬКО для одного шота группы (order бита) под трек — новая версия в
 * истории (старые не удаляются). Нужен, чтобы дёшево перегенерировать один
 * неудачный шот, а не всю группу. Возвращает id новой версии — клиент делает её
 * открытой, и на генерацию уйдёт именно она.
 */
export async function generateSingleShotPrompt(
  shotId: string,
  family: PromptFamily,
  beatOrder: number,
  llmModel?: string,
): Promise<Result> {
  await requireAuth();
  try {
    const meta = PROMPT_FAMILIES.find((f) => f.id === family);
    if (!meta) return { ok: false, error: `Неизвестный трек: ${family}` };
    const data = await llmShotPrompt(shotId, meta.targetModel, llmModel, beatOrder);
    const promptId = await insertVersion(
      shotId,
      meta.targetModel,
      data,
      null,
      `Только шот ${beatOrder}`,
    );
    return { ok: true, promptId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/**
 * Удалить промпт трека (Seedance/Kling) целиком — все его версии — чтобы можно
 * было сгенерировать заново «с чистого листа». Ссылки не оставляем сиротами:
 * генерации, созданные этими промптами, теряют promptId (видео сохраняются).
 */
export async function deleteTrackPrompts(
  shotId: string,
  family: PromptFamily,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(prompts).where(eq(prompts.shotId, shotId));
  const ids = rows.filter((p) => promptFamily(p.targetModel) === family).map((p) => p.id);
  if (!ids.length) return { ok: true };
  // не оставляем мёртвых ссылок: генерации этого промпта отвязываем (видео живут)
  await db.update(generations).set({ promptId: null }).where(inArray(generations.promptId, ids));
  await db.delete(prompts).where(inArray(prompts.id, ids));
  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (shot) {
    // статус вернётся к draft, если промптов и результатов больше нет
    const { recalcShotStatus } = await import("@/lib/generation");
    await recalcShotStatus(shotId);
    revalidatePath(`/episodes/${shot.episodeId}/shots/${shotId}`);
    revalidatePath(`/episodes/${shot.episodeId}`);
  }
  return { ok: true };
}

/** Удалить ОДНУ версию промпта (открытую), остальные версии трека сохраняются. */
export async function deletePromptVersion(
  promptId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db.select().from(prompts).where(eq(prompts.id, promptId));
  if (!row) return { ok: false, error: "Промпт не найден" };
  // не оставляем мёртвых ссылок: генерации этой версии отвязываем (видео живут)
  await db.update(generations).set({ promptId: null }).where(eq(generations.promptId, promptId));
  await db.delete(prompts).where(eq(prompts.id, promptId));
  const [shot] = await db.select().from(shots).where(eq(shots.id, row.shotId));
  if (shot) {
    // статус вернётся к draft, если промптов и результатов больше не осталось
    const { recalcShotStatus } = await import("@/lib/generation");
    await recalcShotStatus(row.shotId);
    revalidatePath(`/episodes/${shot.episodeId}/shots/${row.shotId}`);
    revalidatePath(`/episodes/${shot.episodeId}`);
  }
  return { ok: true };
}

/** U4 — замечание → версия N+1 через промпт-фабрику. */
export async function revisePrompt(promptId: string, feedback: string, epoch?: string): Promise<Result> {
  await requireAuth();
  try {
    const db = await getDb();
    const [prev] = await db.select().from(prompts).where(eq(prompts.id, promptId));
    if (!prev) return { ok: false, error: "Промпт не найден" };
    if (epoch) await markEpoch(prev.shotId, epoch);
    const data = await llmRevisePrompt(promptId, feedback);
    // отменена (или заменена новой задачей) — результат в данные НЕ пишем
    if (await epochStale(prev.shotId, epoch)) return { ok: false, error: "Генерация отменена" };
    // приёмы прошлой версии не теряются, если ревизия не выбрала свои
    if (!data.used_technique_ids.length) {
      const prevParams = JSON.parse(prev.paramsJson || "{}") as { techniques?: string[] };
      data.used_technique_ids = prevParams.techniques ?? [];
    }
    const newId = await insertVersion(prev.shotId, prev.targetModel, data, promptId, feedback);
    return { ok: true, promptId: newId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Неизвестная ошибка" };
  }
}

/** Ручная правка: сохранить текст как новую версию без LLM. */
export async function saveManualVersion(
  promptId: string,
  text: string,
  note: string,
): Promise<Result> {
  await requireAuth();
  const db = await getDb();
  const [prev] = await db.select().from(prompts).where(eq(prompts.id, promptId));
  if (!prev) return { ok: false, error: "Промпт не найден" };
  const params = JSON.parse(prev.paramsJson || "{}");
  const newId = await insertVersion(
    prev.shotId,
    prev.targetModel,
    {
      prompt: text,
      negative_prompt: prev.negativePrompt ?? "",
      reference_element_names: params.reference_element_names ?? [],
      used_technique_ids: params.techniques ?? [],
      params: { aspect_ratio: params.aspect_ratio ?? "9:16", duration: params.duration ?? 15 },
    },
    promptId,
    note || "Ручная правка",
  );
  return { ok: true, promptId: newId };
}
