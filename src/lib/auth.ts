import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "ss_session";

/**
 * Сравнение секретов за постоянное время. Сравниваем ХЭШИ, а не сами строки:
 * timingSafeEqual требует одинаковой длины буферов (иначе бросает), а длина
 * секрета — сама по себе утечка.
 */
export function secretEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

function sessionToken(password: string): string {
  return createHmac("sha256", password).update("series-studio-session-v1").digest("hex");
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/**
 * Пустой APP_PASSWORD открывает ВСЁ приложение: загрузку файлов, ZIP-экспорт,
 * сохранённые OAuth-токены провайдеров. Локально так удобно, в проде это дыра
 * ценой одной забытой переменной окружения — поэтому пускаем без пароля только
 * вне прода либо при явном ALLOW_NO_AUTH=1 («да, я правда хочу открытый доступ»).
 */
function noAuthAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.ALLOW_NO_AUTH === "1") return true;
  console.error(
    "APP_PASSWORD не задан в production — доступ закрыт. Задайте APP_PASSWORD " +
      "или ALLOW_NO_AUTH=1, если открытый доступ действительно нужен.",
  );
  return false;
}

// ---------- защита от онлайнового подбора пароля ----------

/**
 * Единственный пароль защищает всё приложение, а вход не стоил ничего — можно
 * было перебирать в лоб. Считаем неудачные попытки и заставляем ждать, пауза
 * удваивается. Счётчик живёт в памяти процесса (перезапуск обнуляет) — этого
 * достаточно: online-подбор он ломает, а offline-стойкость от него не зависит.
 *
 * Два ведра. По IP — основное (5 бесплатных попыток, пауза до 5 минут). Общее —
 * страховка от подмены x-forwarded-for: порог выше и пауза короче, чтобы
 * подборщик упёрся в потолок, а владелец не залипал надолго.
 */
type Attempt = { fails: number; until: number };
const g = globalThis as typeof globalThis & { __ssLoginAttempts?: Map<string, Attempt> };
const attempts = (g.__ssLoginAttempts ??= new Map<string, Attempt>());

const GLOBAL_KEY = "*";
const LIMITS = {
  ip: { free: 5, capMs: 300_000 },
  global: { free: 20, capMs: 60_000 },
};

function backoffMs(fails: number, free: number, capMs: number): number {
  if (fails <= free) return 0;
  return Math.min(1000 * 2 ** (fails - free - 1), capMs);
}

function limitsFor(key: string) {
  return key === GLOBAL_KEY ? LIMITS.global : LIMITS.ip;
}

/** Сколько секунд ещё ждать этому клиенту (0 — можно пробовать). */
function lockedForSec(keys: string[]): number {
  const now = Date.now();
  const waitMs = Math.max(0, ...keys.map((k) => (attempts.get(k)?.until ?? 0) - now));
  return Math.ceil(waitMs / 1000);
}

function noteFailure(keys: string[]): void {
  const now = Date.now();
  for (const key of keys) {
    const cur = attempts.get(key) ?? { fails: 0, until: 0 };
    const fails = cur.fails + 1;
    const { free, capMs } = limitsFor(key);
    attempts.set(key, { fails, until: now + backoffMs(fails, free, capMs) });
  }
}

async function clientKeys(): Promise<string[]> {
  const h = await headers();
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return [ip, GLOBAL_KEY];
}

// ---------- сессия ----------

export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return noAuthAllowed();
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return false;
  return secretEquals(value, sessionToken(password));
}

/** Call at the top of every page/action that requires login. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Отказ несёт паузу: retryAfterSec > 0 — сработал анти-брутфорс, а не пароль. */
export type LoginResult = { ok: true } | { ok: false; retryAfterSec: number };

export async function login(password: string): Promise<LoginResult> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return noAuthAllowed() ? { ok: true } : { ok: false, retryAfterSec: 0 };

  const keys = await clientKeys();
  const wait = lockedForSec(keys);
  if (wait > 0) return { ok: false, retryAfterSec: wait };

  if (!secretEquals(password, expected)) {
    noteFailure(keys);
    return { ok: false, retryAfterSec: lockedForSec(keys) };
  }
  for (const key of keys) attempts.delete(key); // вошёл — счётчик обнуляем

  const store = await cookies();
  store.set(COOKIE, sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
