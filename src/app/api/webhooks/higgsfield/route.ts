import { NextRequest, NextResponse } from "next/server";
import { secretEquals } from "@/lib/auth";
import { pollActiveGenerations } from "@/lib/generation";

export const maxDuration = 60;

/**
 * Вебхук Higgsfield (TZ M4: использовать вместо поллинга, если доступен).
 * URL передаётся в задачу как webhook_url c ?secret=CRON_SECRET.
 * Тело не парсим детально — по сигналу просто перепроверяем активные задачи.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // сравнение постоянного времени: обычный !== отвечает тем быстрее, чем раньше
  // разошлись строки, и по времени ответа секрет добирается посимвольно
  if (!secret || !secretEquals(req.nextUrl.searchParams.get("secret") ?? "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pollActiveGenerations();
  return NextResponse.json({ ok: true, ...result });
}
