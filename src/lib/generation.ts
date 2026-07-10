/**
 * Ядро центра генерации (M4): каталог, постановка задач, поллинг статусов,
 * скачивание результатов в своё хранилище (M5). Используется server actions,
 * cron-роутом и вебхуком.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, generations, prompts, references, shots, videoModels } from "@/lib/db";
import { getProvider, providerConfigured } from "@/lib/providers";
import { readMockSample } from "@/lib/providers/mock";
import { getFileUrl, putFile, readFile, saveFromUrl } from "@/lib/storage";

// ---------- Каталог моделей (TZ §0.2) ----------

export async function refreshCatalog(): Promise<{ count: number; source: string }> {
  const provider = getProvider();
  const models = await provider.listModels();
  const db = await getDb();
  let sort = 0;
  for (const m of models) {
    await db
      .insert(videoModels)
      .values({
        id: m.id,
        name: m.name,
        kind: m.kind,
        provider: provider.name,
        paramsJson: JSON.stringify(m.params ?? {}),
        credits: m.credits ?? null,
        sortIndex: sort++,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: videoModels.id,
        set: {
          name: m.name,
          kind: m.kind,
          paramsJson: JSON.stringify(m.params ?? {}),
          credits: m.credits ?? null,
          fetchedAt: new Date(),
        },
      });
  }
  return { count: models.length, source: provider.name };
}

export async function getCatalog(kind?: "video" | "image"): Promise<
  Array<{ id: string; name: string; kind: string; credits: number | null }>
> {
  const db = await getDb();
  let rows = await db
    .select()
    .from(videoModels)
    .where(eq(videoModels.active, true))
    .orderBy(asc(videoModels.sortIndex));
  if (!rows.length) {
    await refreshCatalog();
    rows = await db
      .select()
      .from(videoModels)
      .where(eq(videoModels.active, true))
      .orderBy(asc(videoModels.sortIndex));
  }
  return rows
    .filter((r) => !kind || r.kind === kind)
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, credits: r.credits }));
}

// ---------- Постановка задач ----------

interface UrlBundle {
  _urls?: { statusUrl?: string; cancelUrl?: string };
  [key: string]: unknown;
}

async function publicUrlForReference(refId: string): Promise<string | null> {
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, refId));
  if (!ref) return null;
  const provider = getProvider();
  // Локальный диск недоступен провайдеру извне — передаём байты через его upload API.
  if (providerConfigured() && !process.env.SUPABASE_URL && provider.uploadFile) {
    const data = await readFile(ref.storagePath);
    const contentType = ref.storagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    return provider.uploadFile(data, contentType);
  }
  return getFileUrl(ref.storagePath);
}

export interface SubmitInput {
  shotId: string;
  promptId: string;
  modelIds: string[];
  startFrameRefId?: string;
  durationSec: number;
  aspectRatio: string;
}

export async function submitJobs(input: SubmitInput): Promise<{ submitted: number }> {
  const db = await getDb();
  const provider = getProvider();
  const [prompt] = await db.select().from(prompts).where(eq(prompts.id, input.promptId));
  if (!prompt) throw new Error("Промпт не найден");

  const startImageUrl = input.startFrameRefId
    ? ((await publicUrlForReference(input.startFrameRefId)) ?? undefined)
    : undefined;

  let submitted = 0;
  for (const modelId of input.modelIds) {
    const params: Record<string, string | number> = {
      aspect_ratio: input.aspectRatio,
      duration: input.durationSec,
    };
    const sub = await provider.submit({
      model: modelId,
      prompt: prompt.text,
      negativePrompt: prompt.negativePrompt ?? undefined,
      params,
      startImageUrl,
    });
    const paramsJson: UrlBundle = {
      ...params,
      start_frame_ref: input.startFrameRefId ?? null,
      _urls: { statusUrl: sub.statusUrl, cancelUrl: sub.cancelUrl },
    };
    await db.insert(generations).values({
      id: crypto.randomUUID(),
      shotId: input.shotId,
      promptId: input.promptId,
      provider: provider.name,
      model: modelId,
      paramsJson: JSON.stringify(paramsJson),
      status: "queued",
      providerJobId: sub.jobId,
      source: "api",
    });
    submitted++;
  }
  await db.update(shots).set({ status: "generating" }).where(eq(shots.id, input.shotId));
  return { submitted };
}

// ---------- Поллинг и приземление результатов ----------

const ACTIVE = ["queued", "running"] as const;

export async function pollActiveGenerations(onlyIds?: string[]): Promise<{
  active: number;
  updated: number;
}> {
  const db = await getDb();
  const provider = getProvider();
  let rows = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  if (onlyIds?.length) rows = rows.filter((r) => onlyIds.includes(r.id));

  let updated = 0;
  for (const gen of rows) {
    if (!gen.providerJobId || gen.provider !== provider.name) continue;
    const bundle = JSON.parse(gen.paramsJson || "{}") as UrlBundle;
    try {
      const status = await provider.getStatus({
        jobId: gen.providerJobId,
        statusUrl: bundle._urls?.statusUrl,
        cancelUrl: bundle._urls?.cancelUrl,
      });
      if (status.status === "queued" || status.status === "running") {
        if (status.status !== gen.status) {
          await db.update(generations).set({ status: status.status }).where(eq(generations.id, gen.id));
          updated++;
        }
        continue;
      }
      // терминальные статусы
      if (status.status === "done") {
        const url = status.resultUrls[0];
        let storagePath: string;
        if (url === "mock://sample") {
          storagePath = await putFile(
            `results/${gen.shotId}/${gen.id}.mp4`,
            await readMockSample(),
            "video/mp4",
          );
        } else if (url) {
          const ext = url.split("?")[0].match(/\.(mp4|webm|mov|png|jpe?g|webp)$/i)?.[0] ?? ".mp4";
          storagePath = await saveFromUrl(url, `results/${gen.shotId}/${gen.id}${ext}`);
        } else {
          throw new Error("Провайдер завершил задачу без URL результата");
        }
        await db
          .update(generations)
          .set({
            status: "done",
            resultStoragePath: storagePath,
            creditsSpent: status.credits ?? gen.creditsSpent,
          })
          .where(eq(generations.id, gen.id));
        // шот переходит в ревью, когда появился первый результат
        const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
        if (shot && shot.status === "generating") {
          await db.update(shots).set({ status: "review" }).where(eq(shots.id, gen.shotId));
        }
      } else {
        await db
          .update(generations)
          .set({
            status: status.status === "cancelled" ? "failed" : status.status,
            error:
              status.status === "cancelled" ? "Задача отменена" : (status.error ?? "Отказ провайдера"),
            creditsSpent: status.credits ?? gen.creditsSpent,
          })
          .where(eq(generations.id, gen.id));
        const [shot] = await db.select().from(shots).where(eq(shots.id, gen.shotId));
        if (shot?.status === "generating") {
          const still = await db
            .select()
            .from(generations)
            .where(inArray(generations.status, [...ACTIVE]));
          if (!still.some((g) => g.shotId === gen.shotId)) {
            const done = await db.select().from(generations).where(eq(generations.shotId, gen.shotId));
            const next = done.some((g) => g.status === "done") ? "review" : "prompted";
            await db.update(shots).set({ status: next }).where(eq(shots.id, gen.shotId));
          }
        }
      }
      updated++;
    } catch (e) {
      // сетевые сбои поллинга не роняют цикл; протухшие мок-задачи закрываем
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Мок-задача не найдена")) {
        await db
          .update(generations)
          .set({ status: "failed", error: message })
          .where(eq(generations.id, gen.id));
        updated++;
      }
    }
  }

  const stillActive = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  return { active: stillActive.length, updated };
}

export async function countActiveGenerations(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(generations)
    .where(inArray(generations.status, [...ACTIVE]));
  return rows.length;
}
