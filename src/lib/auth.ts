import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "ss_session";

function sessionToken(password: string): string {
  return createHmac("sha256", password).update("series-studio-session-v1").digest("hex");
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // local mode without a password
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return false;
  const expected = sessionToken(password);
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

/** Call at the top of every page/action that requires login. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

export async function login(password: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  if (password !== expected) return false;
  const store = await cookies();
  store.set(COOKIE, sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return true;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
