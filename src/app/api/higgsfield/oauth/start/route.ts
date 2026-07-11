import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { beginAuth } from "@/lib/higgsfieldMcp";

/** Старт подключения Higgsfield: регистрируем клиента и уводим на логин. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAuth();
  try {
    const url = await beginAuth(req.nextUrl.origin);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.redirect(
      `${req.nextUrl.origin}/settings?hf_error=${encodeURIComponent(msg)}`,
    );
  }
}
