"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, entities, references } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import { normalizeElementName } from "@/lib/entityName";

export type EntityType = "character" | "location" | "prop" | "style";

function slugify(name: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y",
    ь: "", э: "e", ю: "yu", я: "ya",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createEntity(input: {
  type: EntityType;
  name: string;
  elementName?: string;
  description?: string;
}): Promise<string> {
  await requireAuth();
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(entities).values({
    id,
    type: input.type,
    name: input.name.trim(),
    // element_name всегда с ведущим @ (заказчик)
    elementName: normalizeElementName(input.elementName?.trim() || slugify(input.name) || id),
    description: input.description ?? "",
  });
  revalidatePath("/bible");
  return id;
}

export async function createEntityAndOpen(formData: FormData): Promise<void> {
  const id = await createEntity({
    type: (formData.get("type") as EntityType) || "character",
    name: String(formData.get("name") || "Без имени"),
  });
  redirect(`/bible/${id}`);
}

const TYPE_TOKEN_PREFIX: Record<EntityType, string> = {
  character: "CHAR",
  location: "LOC",
  prop: "OBJ",
  style: "STYLE",
};

/** Spec §2.7: «+ Добавить» создаёт сущность с токеном CHAR_N/LOC_N/OBJ_N и открывает карточку. */
export async function quickCreateEntity(type: EntityType): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const rows = await db.select().from(entities).where(eq(entities.type, type));
  const prefix = TYPE_TOKEN_PREFIX[type];
  const max = rows.reduce((acc, e) => {
    const n = e.elementName.match(new RegExp(`^@?${prefix}_(\\d+)$`, "i"))?.[1];
    return n ? Math.max(acc, Number(n)) : acc;
  }, 0);
  const token = normalizeElementName(`${prefix}_${max + 1}`);
  const id = crypto.randomUUID();
  await db.insert(entities).values({
    id,
    type,
    name: `Без имени ${max + 1}`,
    elementName: token,
    description: "",
  });
  revalidatePath("/bible");
  redirect(`/bible/${id}`);
}

/** Spec §2.7: удаление сущности — пропадает из библии и из чипов шотов. */
export async function deleteEntity(id: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const { shotEntities } = await import("@/lib/db");
  await db.delete(shotEntities).where(eq(shotEntities.entityId, id));
  const refs = await db.select().from(references).where(eq(references.entityId, id));
  for (const ref of refs.filter((r) => !r.shotId)) {
    await db.delete(references).where(eq(references.id, ref.id));
    const still = await db
      .select()
      .from(references)
      .where(eq(references.storagePath, ref.storagePath));
    if (still.length === 0) await deleteFile(ref.storagePath).catch(() => {});
  }
  await db.delete(entities).where(eq(entities.id, id));
  revalidatePath("/bible");
  redirect("/bible");
}

export async function updateEntity(
  id: string,
  patch: {
    name?: string;
    elementName?: string;
    description?: string;
    wardrobe?: string;
    type?: EntityType;
    soulId?: string;
  },
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const clean =
    patch.elementName !== undefined
      ? { ...patch, elementName: normalizeElementName(patch.elementName) }
      : patch;
  await db.update(entities).set(clean).where(eq(entities.id, id));
  revalidatePath(`/bible/${id}`);
  revalidatePath("/bible");
}

export async function setEntityArchived(id: string, archived: boolean): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(entities).set({ archived }).where(eq(entities.id, id));
  revalidatePath("/bible");
  revalidatePath(`/bible/${id}`);
}

export async function updateReferenceCaption(id: string, caption: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(references).set({ caption }).where(eq(references.id, id));
}

/** Пометка «только лицо»: одежду с этого референса не якорить (роль face). */
export async function setReferenceFace(id: string, face: boolean): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, id));
  if (!ref) return;
  // роль переключаем только между face и null — start_frame и др. не трогаем
  if (!face && ref.role !== "face") return;
  await db.update(references).set({ role: face ? "face" : null }).where(eq(references.id, id));
  if (ref.entityId) revalidatePath(`/bible/${ref.entityId}`);
}

/**
 * Кнопка «Анализ» (библия): vision-модель заполняет описание, гардероб и
 * пометку «только лицо» по референсу. Возвращает результат — форма обновляет
 * поля без перезагрузки.
 */
export async function analyzeEntityReference(
  refId: string,
): Promise<
  | { ok: true; description: string; wardrobe: string; faceOnly: boolean; caption: string }
  | { ok: false; error: string }
> {
  await requireAuth();
  try {
    const db = await getDb();
    const [ref] = await db.select().from(references).where(eq(references.id, refId));
    if (!ref?.entityId) return { ok: false, error: "Референс не привязан к сущности" };
    const { llmAnalyzeCharacterRef } = await import("@/lib/llm/factory");
    const res = await llmAnalyzeCharacterRef(refId);

    const patch: Record<string, string> = {};
    if (res.description.trim()) patch.description = res.description.trim();
    if (res.wardrobe.trim()) patch.wardrobe = res.wardrobe.trim();
    if (Object.keys(patch).length) {
      await db.update(entities).set(patch).where(eq(entities.id, ref.entityId));
    }
    const refPatch: Record<string, string | null> = {};
    if (res.caption.trim() && !ref.caption) refPatch.caption = res.caption.trim();
    if (res.face_only && ref.role !== "start_frame") refPatch.role = "face";
    if (Object.keys(refPatch).length) {
      await db.update(references).set(refPatch).where(eq(references.id, refId));
    }
    revalidatePath(`/bible/${ref.entityId}`);
    revalidatePath("/bible");
    return {
      ok: true,
      description: res.description.trim(),
      wardrobe: res.wardrobe.trim(),
      faceOnly: res.face_only,
      caption: res.caption.trim(),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось проанализировать" };
  }
}

export async function deleteReference(id: string): Promise<void> {
  await requireAuth();
  const db = await getDb();
  const [ref] = await db.select().from(references).where(eq(references.id, id));
  if (!ref) return;
  await db.delete(references).where(eq(references.id, id));
  // remove the blob only if no other reference rows point at it
  const still = await db.select().from(references).where(eq(references.storagePath, ref.storagePath));
  if (still.length === 0) await deleteFile(ref.storagePath).catch(() => {});
  if (ref.entityId) revalidatePath(`/bible/${ref.entityId}`);
  revalidatePath("/bible");
}
