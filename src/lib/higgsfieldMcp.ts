/**
 * Higgsfield MCP — генерация видео на КРЕДИТАХ ПОДПИСКИ (не Cloud API).
 *
 * Официальный хостед MCP-сервер mcp.higgsfield.ai/mcp работает с кредитами
 * плана («plan credits work seamlessly through any connected agent»).
 * Приложение подключается как MCP-клиент по стандартному OAuth 2.1:
 *  - Dynamic Client Registration (POST /oauth2/register, публичный клиент, PKCE S256)
 *  - authorization_code + refresh_token (scope openid email offline_access)
 * Всё состояние (client_id, токены, pending PKCE) живёт в таблице settings.
 * Проверено живым сервером: 401+resource_metadata, DCR отвечает 201.
 */
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDb, settings } from "@/lib/db";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const AUTHORIZE_URL = "https://mcp.higgsfield.ai/oauth2/authorize";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
const REGISTER_URL = "https://mcp.higgsfield.ai/oauth2/register";
const SCOPE = "openid email offline_access";

// ---------- хранение в settings ----------

/** Сеть до *.higgsfield.ai флапает из Node (undici) — первый fetch может упасть, повтор проходит. */
async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const K_CLIENT = "hf_mcp_client"; // {client_id, redirect_uri}
const K_TOKENS = "hf_mcp_tokens"; // {access_token, refresh_token?, expires_at}
const K_PENDING = "hf_mcp_pending"; // {verifier, state, redirect_uri}

async function readKey<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } });
}

async function deleteKey(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(settings).where(eq(settings.key, key));
}

// ---------- OAuth ----------

interface ClientReg {
  client_id: string;
  redirect_uri: string;
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // ms epoch
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function ensureClient(redirectUri: string): Promise<ClientReg> {
  const existing = await readKey<ClientReg>(K_CLIENT);
  if (existing && existing.redirect_uri === redirectUri) return existing;
  const res = await fetchRetry(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Series Studio",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`Higgsfield MCP: регистрация клиента не удалась (${res.status})`);
  const body = (await res.json()) as { client_id: string };
  const reg = { client_id: body.client_id, redirect_uri: redirectUri };
  await writeKey(K_CLIENT, reg);
  return reg;
}

/** Шаг 1: URL авторизации — пользователь логинится в свой аккаунт Higgsfield. */
export async function beginAuth(origin: string): Promise<string> {
  const redirectUri = `${origin}/api/higgsfield/oauth/callback`;
  const client = await ensureClient(redirectUri);
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  await writeKey(K_PENDING, { verifier, state, redirect_uri: redirectUri });
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetchRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`Higgsfield MCP: токен не выдан (${res.status} ${body.error ?? ""})`);
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/** Шаг 2: обмен кода из callback на токены. */
export async function completeAuth(code: string, state: string): Promise<void> {
  const pending = await readKey<{ verifier: string; state: string; redirect_uri: string }>(K_PENDING);
  if (!pending || pending.state !== state) {
    throw new Error("Higgsfield MCP: state не совпал — начните подключение заново");
  }
  const client = await readKey<ClientReg>(K_CLIENT);
  if (!client) throw new Error("Higgsfield MCP: клиент не зарегистрирован");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirect_uri,
    client_id: client.client_id,
    code_verifier: pending.verifier,
  });
  await writeKey(K_TOKENS, tokens);
  await deleteKey(K_PENDING);
}

/** Валидный access_token (с refresh при истечении); null — не подключено. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await readKey<Tokens>(K_TOKENS);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  if (!tokens.refresh_token) {
    await deleteKey(K_TOKENS); // истёк без refresh — нужно переподключение
    return null;
  }
  const client = await readKey<ClientReg>(K_CLIENT);
  if (!client) return null;
  try {
    const fresh = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    // некоторые серверы не возвращают новый refresh — сохраняем старый
    if (!fresh.refresh_token) fresh.refresh_token = tokens.refresh_token;
    await writeKey(K_TOKENS, fresh);
    return fresh.access_token;
  } catch {
    await deleteKey(K_TOKENS);
    return null;
  }
}

export async function isConnected(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

export async function disconnect(): Promise<void> {
  await deleteKey(K_TOKENS);
  await deleteKey(K_PENDING);
}

// ---------- MCP-клиент ----------

async function withMcp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Higgsfield не подключён — нажмите «Подключить» в настройках");
  // connect ретраим всегда (сеть флапает); сам fn — ответственность вызывающего
  let client: Client | null = null;
  let lastErr: unknown;
  for (let i = 0; i < 3 && !client; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const c = new Client({ name: "series-studio", version: "1.0.0" });
      await c.connect(transport);
      client = c;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  if (!client) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Список инструментов сервера (имена/схемы моделей — Kling, Seedance, баланс…). */
export async function listMcpTools(): Promise<McpToolInfo[]> {
  return withMcp(async (client) => {
    const res = await client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
    }));
  });
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

/**
 * Вызов инструмента; результат MCP — контент-блоки, собираем текст.
 * retry — ТОЛЬКО для идемпотентных вызовов (каталог, статус, импорт медиа);
 * generate_* не ретраим, чтобы не задвоить списание кредитов.
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  opts?: { retry?: boolean },
): Promise<McpCallResult> {
  const attempts = opts?.retry ? 3 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withMcp(async (client) => {
        const res = await client.callTool({ name, arguments: args });
        const content = Array.isArray(res.content) ? res.content : [];
        const text = content
          .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
          .filter(Boolean)
          .join("\n");
        return { text, isError: Boolean(res.isError) };
      });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
