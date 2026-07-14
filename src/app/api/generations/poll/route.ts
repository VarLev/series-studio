import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { activityFingerprint, pollActiveGenerations } from "@/lib/generation";

export const maxDuration = 60;

/**
 * Поллинг статусов Higgsfield (TZ M4): дергается (а) клиентом, пока открыта
 * страница с активными задачами, и (б) фоновым cron (Supabase pg_cron / любой
 * планировщик) с заголовком x-cron-secret = CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const viaCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!viaCron && !(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pollActiveGenerations();
  // отпечаток состояния — клиент (GenPoller) рефрешит страницу только при его смене
  const fp = await activityFingerprint();
  return NextResponse.json({ ...result, fp });
}
