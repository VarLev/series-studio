"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, entities, references, settings, shots, shotEntities } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getCatalog, nextRefToken, submitReferenceJob } from "@/lib/generation";
import { putFile, readFile } from "@/lib/storage";
import { imageModelMeta } from "@/lib/imageModels";
import { effectiveOutfit } from "@/lib/wardrobe";
import { attachReferenceToShot, setShotReferenceRole } from "@/lib/actions/shots";
import { setSetting } from "@/lib/settings";

type Result = { ok: true } | { ok: false; error: string };

/** «1–4, 7» из отсортированных номеров панелей. */
function panelRanges(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? `${nums[i]}` : `${nums[i]}–${nums[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/**
 * Фиксация одежды для листа раскадровки: главная причина «персонаж переоделся
 * между панелями». Раньше блок собирался только для листа одного шота — то есть
 * ровно там, где он нужен меньше всего; лист «вся серия» (9 панелей через полсерии)
 * уходил без него.
 *
 * Наряд берётся якорями групп (effectiveOutfit: сценарный наряд, иначе гардероб
 * библии). Если известна карта «панель → группа», одежда фиксируется ПОПАНЕЛЬНО —
 * так лист честно отражает сюжет, где персонаж действительно переодевается:
 *   - Simon: panels 1–4 — black hoodie; panels 5–9 — hospital gown
 * Без карты (ручной вызов старым клиентом) фиксируем только персонажей с
 * единственным нарядом: угадывать, в чём герой на конкретной панели, нельзя.
 */
async function buildWardrobeLock(input: {
  episodeId: string;
  scopeShotId: string | null;
  panelShotIds: string[];
}): Promise<string> {
  const db = await getDb();
  const panelIds = input.panelShotIds.filter(Boolean);
  let shotIds: string[];
  if (panelIds.length) shotIds = [...new Set(panelIds)];
  else if (input.scopeShotId) shotIds = [input.scopeShotId];
  else {
    shotIds = (
      await db.select({ id: shots.id }).from(shots).where(eq(shots.episodeId, input.episodeId))
    ).map((s) => s.id);
  }
  if (!shotIds.length) return "";

  const links = await db.select().from(shotEntities).where(inArray(shotEntities.shotId, shotIds));
  if (!links.length) return "";
  const charRows = await db
    .select()
    .from(entities)
    .where(inArray(entities.id, [...new Set(links.map((l) => l.entityId))]));
  const charById = new Map(charRows.filter((e) => e.type === "character").map((e) => [e.id, e]));

  // персонаж → (группа → наряд в этой группе)
  const byChar = new Map<string, Map<string, string>>();
  for (const l of links) {
    const entity = charById.get(l.entityId);
    if (!entity) continue;
    const outfit = effectiveOutfit(l, entity.wardrobe);
    if (!outfit) continue;
    if (!byChar.has(entity.id)) byChar.set(entity.id, new Map());
    byChar.get(entity.id)!.set(l.shotId, outfit);
  }

  const lines: string[] = [];
  for (const [entityId, byShot] of byChar) {
    const name = charById.get(entityId)!.elementName;
    if (panelIds.length) {
      // наряд → номера панелей, на которых персонаж в нём
      const byOutfit = new Map<string, number[]>();
      panelIds.forEach((shotId, i) => {
        const outfit = byShot.get(shotId);
        if (!outfit) return;
        if (!byOutfit.has(outfit)) byOutfit.set(outfit, []);
        byOutfit.get(outfit)!.push(i + 1);
      });
      if (!byOutfit.size) continue;
      lines.push(
        byOutfit.size === 1
          ? `- ${name}: ${[...byOutfit.keys()][0]}`
          : `- ${name}: ` +
            [...byOutfit]
              .map(([outfit, panels]) => `panels ${panelRanges(panels)} — ${outfit}`)
              .join("; "),
      );
    } else {
      const distinct = [...new Set(byShot.values())];
      if (distinct.length === 1) lines.push(`- ${name}: ${distinct[0]}`);
    }
  }
  if (!lines.length) return "";
  return (
    "\n\nWardrobe lock — keep each character's clothing exactly as specified, " +
    "identical in every panel where they appear:\n" +
    lines.join("\n")
  );
}

// Тайник исхода постановки листа (самовосстановление через туннель, паттерн
// breakdownEpisode): постановка идёт десятки секунд (Google рисует прямо в этом
// запросе), и ответ экшена часто теряется. Тогда пользователь не знал, ушла ли
// задача, и жал кнопку снова — второй платный лист. Теперь исход кладётся в
// settings под клиентским ТОКЕНОМ запуска: клиент добирает его поллингом, а
// повтор с тем же токеном не создаёт вторую задачу.
const sbStashKey = (episodeId: string) => `sb_result:${episodeId}`;

type GlobalSbLock = typeof globalThis & { __ssStoryboardInflight?: Map<string, Promise<Result>> };

/**
 * Поллинг тайника: исход запуска с этим токеном, когда generateStoryboard его
 * сохранит; null — ещё не готово / чужой запуск.
 */
export async function pollStoryboardResult(
  episodeId: string,
  token: string,
): Promise<Result | null> {
  await requireAuth();
  const db = await getDb();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, sbStashKey(episodeId)));
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { token?: string; ok?: boolean; error?: string };
    if (parsed.token !== token) return null;
    if (parsed.ok) return { ok: true };
    if (parsed.ok === false) return { ok: false, error: parsed.error ?? "Неизвестная ошибка" };
  } catch {}
  return null;
}

export interface StoryboardInput {
  episodeId: string;
  shotId?: string | null;
  frames: 4 | 9;
  resolution: "1k" | "2k" | "4k";
  prompt: string;
  refIds: string[];
  model?: string;
  /**
   * Карта «панель → группа»: id группы, из бита которой собрана панель N.
   * Длина = frames. Клиент строит её тем же проходом, что и текст сюжета.
   */
  panelShotIds?: string[];
  /** токен клиента — метит тайник исхода и глушит повторы того же запуска */
  token?: string;
}

/**
 * Лист раскадровки (spec-дополнение заказчика): вертикальное изображение 9:16
 * с сеткой 2×2 или 3×3 вертикальных кадров. Область — вся серия или один шот.
 * Результат приземляется как референс серии (REF_NN) с пометкой grid.
 */
export async function generateStoryboard(input: StoryboardInput): Promise<Result> {
  await requireAuth();
  const token = input.token?.trim();
  if (!token) return submitStoryboard(input);

  const g = globalThis as GlobalSbLock;
  if (!g.__ssStoryboardInflight) g.__ssStoryboardInflight = new Map();
  // тот же токен уже в работе (браузер/Next повторяют долгий экшен, пока первый
  // жив) — ждём первый вызов, второй платной задачи не ставим
  const inflight = g.__ssStoryboardInflight.get(token);
  if (inflight) return inflight;
  // тот же токен уже отработал (повтор после ответа) — отдаём сохранённый исход
  const done = await pollStoryboardResult(input.episodeId, token);
  if (done) return done;

  const work = submitStoryboard(input)
    .then(async (res) => {
      try {
        await setSetting(sbStashKey(input.episodeId), JSON.stringify({ token, ...res }));
      } catch {}
      return res;
    })
    .finally(() => {
      g.__ssStoryboardInflight!.delete(token);
    });
  g.__ssStoryboardInflight.set(token, work);
  return work;
}

async function submitStoryboard(input: StoryboardInput): Promise<Result> {
  try {
    if (!input.prompt.trim()) return { ok: false, error: "Промпт раскадровки пуст" };
    if (input.frames !== 4 && input.frames !== 9) {
      return { ok: false, error: "В сетке может быть 4 или 9 кадров" };
    }
    const db = await getDb();
    const catalog = await getCatalog("image");
    const model =
      (input.model && catalog.find((m) => m.id === input.model)) ??
      catalog.find((m) => m.id.includes("nano_banana")) ??
      catalog[0];
    if (!model) return { ok: false, error: "В каталоге нет image-моделей" };
    const meta = imageModelMeta(model.id);
    const value = meta?.cost[input.resolution] ?? Object.values(meta?.cost ?? {})[0] ?? 6;
    const usd = meta?.unit === "usd" ? value : null;
    const credits = meta?.unit === "usd" ? null : value;

    let caption = `Раскадровка ${input.frames === 9 ? "3×3" : "2×2"} · вся серия`;
    if (input.shotId) {
      const [shot] = await db.select().from(shots).where(eq(shots.id, input.shotId));
      if (!shot || shot.episodeId !== input.episodeId) {
        return { ok: false, error: "Шот не найден в этой серии" };
      }
      caption = `Раскадровка ${input.frames === 9 ? "3×3" : "2×2"} · группа ${String(shot.orderIndex).padStart(2, "0")}`;
    }

    // карта панелей — только группы ЭТОЙ серии и ровно по числу панелей: она
    // управляет привязкой кадров к группам, врать ей нельзя
    const episodeShotIds = new Set(
      (
        await db.select({ id: shots.id }).from(shots).where(eq(shots.episodeId, input.episodeId))
      ).map((s) => s.id),
    );
    const panelShotIds =
      input.panelShotIds?.length === input.frames &&
      input.panelShotIds.every((id) => episodeShotIds.has(id))
        ? input.panelShotIds
        : [];

    const prompt =
      input.prompt.trim() +
      (await buildWardrobeLock({
        episodeId: input.episodeId,
        scopeShotId: input.shotId ?? null,
        panelShotIds,
      }));

    await submitReferenceJob({
      episodeId: input.episodeId,
      model: model.id,
      prompt,
      aspectRatio: "9:16",
      resolution: input.resolution,
      sourceRefIds: input.refIds.length ? input.refIds : undefined,
      sourceTag: "storyboard",
      credits,
      usd,
      sbGrid: input.frames,
      sbShotId: input.shotId ?? null,
      sbPanels: panelShotIds,
      caption,
    });
    revalidatePath(`/episodes/${input.episodeId}`);
    revalidatePath(`/episodes/${input.episodeId}/refs`);
    revalidatePath("/queue");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить задачу" };
  }
}

/**
 * Разрезать лист на отдельные кадры: сетка grid (4 → 2×2, 9 → 3×3) режется sharp'ом,
 * каждый кадр становится самостоятельным референсом серии (REF_NN, source=storyboard-frame).
 * Исходный лист не тронут; кадры — отдельные файлы, живут независимо от листа.
 *
 * Кадр наследует группу своей панели из карты листа (sb_panels) — иначе, как
 * раньше, все кадры листа «вся серия» оставались без группы и не могли стать
 * стартовыми кадрами.
 */
export async function sliceStoryboard(
  refId: string,
  /** обрезать рамки/гаттеры между панелями (Nano Banana иногда их рисует) */
  trimGutters = false,
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const db = await getDb();
    const [sheet] = await db.select().from(references).where(eq(references.id, refId));
    if (!sheet?.episodeId) return { ok: false, error: "Лист не найден" };
    if (sheet.grid !== 4 && sheet.grid !== 9) {
      return { ok: false, error: "Это не лист раскадровки — резать нечего" };
    }

    let panels: string[] = [];
    try {
      const parsed = JSON.parse(sheet.sbPanels || "[]");
      if (Array.isArray(parsed)) panels = parsed as string[];
    } catch {}

    const data = await readFile(sheet.storagePath);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return { ok: false, error: "Не удалось прочитать изображение" };

    const n = sheet.grid === 9 ? 3 : 2; // кадров на сторону
    const cellW = Math.floor(meta.width / n);
    const cellH = Math.floor(meta.height / n);
    if (cellW < 16 || cellH < 16) return { ok: false, error: "Изображение слишком маленькое для разрезки" };
    // отступ внутрь ячейки: срезает нарисованную рамку и края соседних панелей
    const inset = trimGutters ? Math.round(Math.min(cellW, cellH) * 0.02) : 0;

    let created = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const panel = row * n + col + 1;
        const cell = await sharp(data)
          .extract({
            left: col * cellW + inset,
            top: row * cellH + inset,
            width: cellW - inset * 2,
            height: cellH - inset * 2,
          })
          .jpeg({ quality: 92 })
          .toBuffer();
        const id = crypto.randomUUID();
        const storagePath = await putFile(
          `refs/series/${sheet.episodeId}/${id}.jpg`,
          cell,
          "image/jpeg",
        );
        const token = await nextRefToken(sheet.episodeId);
        await db.insert(references).values({
          id,
          episodeId: sheet.episodeId,
          storagePath,
          caption: `${sheet.token ?? "лист"} · кадр ${panel}`,
          source: "storyboard-frame",
          token,
          width: cellW - inset * 2,
          height: cellH - inset * 2,
          parentId: sheet.id,
          // группа панели из карты листа; лист одного шота — вся его сетка о нём
          sbShotId: panels[panel - 1] ?? sheet.sbShotId,
          sbPanel: panel,
        });
        created++;
      }
    }
    revalidatePath(`/episodes/${sheet.episodeId}`);
    revalidatePath(`/episodes/${sheet.episodeId}/refs`);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось разрезать лист" };
  }
}

/**
 * Кадр раскадровки → стартовый кадр своей группы. Один и тот же файл повторным
 * вызовом не задваивается: уже прикреплённая копия просто повышается в роли.
 */
async function bindFrameToShot(
  frame: typeof references.$inferSelect,
  shotId: string,
): Promise<void> {
  const db = await getDb();
  const attached = await db.select().from(references).where(eq(references.shotId, shotId));
  const copy = attached.find((r) => r.storagePath === frame.storagePath);
  if (!copy) await attachReferenceToShot(shotId, frame.id, "start_frame");
  else if (copy.role !== "start_frame") await setShotReferenceRole(copy.id, "start_frame");
}

/**
 * Разрезанный лист → стартовые кадры групп в один тап. Стартовый кадр у группы
 * один, поэтому от каждой группы берётся её ПЕРВАЯ панель на листе (панели идут
 * по порядку истории), а внутри панели — самая свежая версия (правка/апскейл
 * кадра важнее исходника).
 */
export async function assignSheetStartFrames(
  sheetId: string,
): Promise<{ ok: true; assigned: number } | { ok: false; error: string }> {
  await requireAuth();
  try {
    const db = await getDb();
    const [sheet] = await db.select().from(references).where(eq(references.id, sheetId));
    if (!sheet?.episodeId) return { ok: false, error: "Лист не найден" };

    const frames = (
      await db.select().from(references).where(eq(references.parentId, sheetId))
    ).filter((f) => f.sbShotId);
    if (!frames.length) {
      return { ok: false, error: "У кадров этого листа нет групп — назначьте кадр вручную" };
    }

    // на панель — самая свежая версия
    const bestByPanel = new Map<string, typeof references.$inferSelect>();
    for (const f of frames) {
      const key = `${f.sbShotId}:${f.sbPanel ?? 0}`;
      const prev = bestByPanel.get(key);
      if (!prev || f.createdAt.getTime() > prev.createdAt.getTime()) bestByPanel.set(key, f);
    }
    // на группу — её первая панель
    const firstByShot = new Map<string, typeof references.$inferSelect>();
    for (const f of [...bestByPanel.values()].sort((a, b) => (a.sbPanel ?? 0) - (b.sbPanel ?? 0))) {
      if (!firstByShot.has(f.sbShotId!)) firstByShot.set(f.sbShotId!, f);
    }

    // группы могли быть удалены после генерации листа
    const alive = new Set(
      (
        await db
          .select({ id: shots.id })
          .from(shots)
          .where(inArray(shots.id, [...firstByShot.keys()]))
      ).map((s) => s.id),
    );

    let assigned = 0;
    for (const [shotId, frame] of firstByShot) {
      if (!alive.has(shotId)) continue;
      await bindFrameToShot(frame, shotId);
      assigned++;
    }
    if (!assigned) return { ok: false, error: "Группы этого листа уже удалены" };
    revalidatePath(`/episodes/${sheet.episodeId}`);
    return { ok: true, assigned };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось назначить кадры" };
  }
}

/** Один кадр раскадровки → стартовый кадр своей группы (ручное подтверждение). */
export async function assignFrameStartFrame(frameId: string): Promise<Result> {
  await requireAuth();
  try {
    const db = await getDb();
    const [frame] = await db.select().from(references).where(eq(references.id, frameId));
    if (!frame) return { ok: false, error: "Кадр не найден" };
    if (!frame.sbShotId) return { ok: false, error: "У кадра нет группы" };
    const [shot] = await db.select().from(shots).where(eq(shots.id, frame.sbShotId));
    if (!shot) return { ok: false, error: "Группа этого кадра уже удалена" };
    await bindFrameToShot(frame, frame.sbShotId);
    revalidatePath(`/episodes/${shot.episodeId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось назначить кадр" };
  }
}
