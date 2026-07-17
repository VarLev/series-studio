"use server";

/**
 * Экшены вкладки «База знаний» (настройки): создание/правка документов,
 * вкл/выкл (выключенный док остаётся в базе, но не подмешивается в
 * промпт-фабрику) и загрузка файлами с устройства — текст читает клиент,
 * сюда приходит строкой (работает и с телефона через туннель, без /api/upload).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, knowledgeDocs } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { guessKnowledgeTags } from "@/lib/knowledgeTags";

type Result = { ok: true } | { ok: false; error: string };

function normalizeTags(raw: string): string {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

/** Создать или обновить документ. Пустые теги → автоопределение по названию и тексту. */
export async function saveKnowledgeDoc(input: {
  id?: string;
  title: string;
  contentMd: string;
  tags: string;
}): Promise<Result> {
  await requireAuth();
  const title = input.title.trim();
  const contentMd = input.contentMd.trim();
  if (!title || !contentMd) return { ok: false, error: "Нужны название и текст документа" };
  const tags = normalizeTags(input.tags) || guessKnowledgeTags(title, contentMd);
  const db = await getDb();
  if (input.id) {
    const [row] = await db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, input.id));
    if (!row) return { ok: false, error: "Документ не найден" };
    await db
      .update(knowledgeDocs)
      .set({ title, contentMd, tags })
      .where(eq(knowledgeDocs.id, input.id));
  } else {
    await db.insert(knowledgeDocs).values({
      id: `kbm-${crypto.randomUUID()}`, // ручной документ — вне namespace kb-<файл>
      title,
      sourceFile: "",
      contentMd,
      tags,
    });
  }
  revalidatePath("/knowledge");
  return { ok: true };
}

/** Вкл/выкл документа: выключенный не подмешивается в промпты, но не удаляется. */
export async function toggleKnowledgeDoc(id: string, enabled: boolean): Promise<void> {
  await requireAuth();
  const db = await getDb();
  await db.update(knowledgeDocs).set({ enabled }).where(eq(knowledgeDocs.id, id));
  revalidatePath("/knowledge");
}

/**
 * Загрузка документов файлами (.md/.txt) с устройства. Id — kb-<имя файла>, как
 * у ingestKnowledge: повторная загрузка одноимённого файла ОБНОВЛЯЕТ документ
 * (ручные правки текста перезапишутся; состояние вкл/выкл сохраняется).
 */
export async function uploadKnowledgeDocs(
  files: Array<{ name: string; content: string }>,
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const db = await getDb();
  let count = 0;
  for (const f of files) {
    const name = f.name.replace(/[\\/]/g, "").trim();
    if (!name || !f.content.trim()) continue;
    const title = name.replace(/\.(md|txt)$/i, "").replace(/[-_]/g, " ");
    const tags = guessKnowledgeTags(name, f.content);
    await db
      .insert(knowledgeDocs)
      .values({ id: `kb-${name}`, title, sourceFile: name, contentMd: f.content, tags })
      .onConflictDoUpdate({
        target: knowledgeDocs.id,
        set: { contentMd: f.content, tags },
      });
    count++;
  }
  revalidatePath("/knowledge");
  return {
    ok: count > 0,
    message: count ? `Загружено документов: ${count}` : "Нет пригодных файлов (.md, .txt)",
  };
}
