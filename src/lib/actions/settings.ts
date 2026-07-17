"use server";

import path from "node:path";
import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, knowledgeDocs } from "@/lib/db";
import { requireAuth, login, logout } from "@/lib/auth";
import { setSetting, DEFAULT_SETTINGS, type SettingKey } from "@/lib/settings";
import { guessKnowledgeTags } from "@/lib/knowledgeTags";

export async function saveSettings(formData: FormData): Promise<void> {
  await requireAuth();
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    const value = formData.get(key);
    if (typeof value === "string") await setSetting(key, value);
  }
  revalidatePath("/costs");
}

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const res = await login(String(formData.get("password") ?? ""));
  if (!res.ok) {
    // пауза от анти-брутфорса — это НЕ «неверный пароль»: не сбиваем с толку
    return {
      error: res.retryAfterSec
        ? `Слишком много попыток. Повторите через ${res.retryAfterSec} с`
        : "Неверный пароль",
    };
  }
  redirect("/episodes");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

/**
 * M3 — база знаний: читает файлы из папки /knowledge репозитория (.md, .txt)
 * и складывает их в knowledge_docs. PDF заказчик конвертирует в markdown
 * (или кладёт .md рядом) — честная конвертация PDF будет добавлена этапом 2.
 * Правки/вкл-выкл документов — на вкладке «База знаний» (actions/knowledge.ts).
 */
export async function ingestKnowledge(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const dir = path.join(process.cwd(), "knowledge");
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { ok: false, message: "Папка /knowledge не найдена — создайте её в корне проекта" };
  }
  const db = await getDb();
  let count = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".md" && ext !== ".txt") continue;
    const content = await fs.readFile(path.join(dir, file), "utf-8");
    const title = file.replace(/\.(md|txt)$/i, "").replace(/[-_]/g, " ");
    await db
      .insert(knowledgeDocs)
      .values({
        id: `kb-${file}`,
        title,
        sourceFile: file,
        contentMd: content,
        tags: guessKnowledgeTags(file, content),
      })
      .onConflictDoUpdate({
        target: knowledgeDocs.id,
        set: { contentMd: content, tags: guessKnowledgeTags(file, content) },
      });
    count++;
  }
  revalidatePath("/knowledge");
  return {
    ok: true,
    message: count
      ? `Загружено документов: ${count}`
      : "В /knowledge нет .md или .txt файлов (PDF сконвертируйте в markdown)",
  };
}
