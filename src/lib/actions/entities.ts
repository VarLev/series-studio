"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, entities, references } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";

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
    elementName: (input.elementName?.trim() || slugify(input.name)) ?? id,
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

export async function updateEntity(
  id: string,
  patch: { name?: string; elementName?: string; description?: string; type?: EntityType; soulId?: string },
): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(entities).set(patch).where(eq(entities.id, id));
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
