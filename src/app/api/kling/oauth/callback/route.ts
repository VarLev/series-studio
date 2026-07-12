import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { completeAuth } from "@/lib/klingMcp";

/** Callback OAuth Kling: обмениваем код на токены и возвращаемся в настройки. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAuth();
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  const back = (q: string) => NextResponse.redirect(`${req.nextUrl.origin}/settings?${q}`);
  if (err) return back(`kling_error=${encodeURIComponent(err)}`);
  if (!code || !state) return back("kling_error=no_code");
  try {
    await completeAuth(code, state);
    return back("kling=connected");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return back(`kling_error=${encodeURIComponent(msg)}`);
  }
}
