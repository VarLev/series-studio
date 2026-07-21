/**
 * Kling MCP: есть ли инструмент правки ВИДЕО (video-to-video edit)?
 * Запуск ТОЛЬКО против КОПИИ БД (живая PGlite однопроцессная, сервер может работать):
 *   node scripts/probe-kling-edit.mjs <путь-к-копии-.data/pglite>
 * Токен из копии НЕ рефрешим: ротация refresh_token рассинхронизировала бы
 * настоящую БД и заставила бы переподключать OAuth.
 */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const dbPath = process.argv[2];
if (!dbPath) {
  console.log("USAGE: node scripts/probe-kling-edit.mjs <путь-к-КОПИИ-.data/pglite>");
  process.exit(1);
}

const db = new PGlite(dbPath);
const tokRow = await db.query(`select value from settings where key = 'kling_mcp_tokens'`);
await db.close();
if (!tokRow.rows.length) {
  console.log("NOT CONNECTED (kling_mcp_tokens отсутствует)");
  process.exit(1);
}
const tokens = JSON.parse(tokRow.rows[0].value);
if (Date.now() >= tokens.expires_at - 60_000) {
  console.log(
    "TOKEN EXPIRED — откройте приложение (любой Kling-экран обновит токен), затем пере-скопируйте БД и повторите",
  );
  process.exit(2);
}

async function withClient(fn) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL("https://kling.ai/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      });
      const c = new Client({ name: "probe", version: "1.0.0" });
      await c.connect(transport);
      try { return await fn(c); } finally { await c.close().catch(() => {}); }
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw lastErr;
}

const tools = await withClient(async (c) => (await c.listTools()).tools);
console.log("=== ВСЕ инструменты ===");
for (const t of tools) console.log(`- ${t.name}: ${(t.description ?? "").slice(0, 120).replace(/\n/g, " ")}`);

// кандидаты на видео-правку — полные схемы без обрезки
const EDIT_RE = /edit|repaint|inpaint|video.*video|modify|revise|extend|restyle|swap|element/i;
const editLike = tools.filter((t) => EDIT_RE.test(`${t.name} ${t.description ?? ""}`));
console.log(`\n=== Кандидаты на видео-правку: ${editLike.length} ===`);
for (const t of editLike) {
  console.log(`\n===== ${t.name} =====`);
  console.log("DESC:", t.description ?? "");
  console.log("SCHEMA:", JSON.stringify(t.inputSchema, null, 1));
}

// file_upload (примет ли video/mp4) и query_tasks (поллинг edit-задач) — полностью
for (const name of ["file_upload", "query_tasks"]) {
  const t = tools.find((x) => x.name === name);
  console.log(`\n===== ${name} ${t ? "" : "(НЕ НАЙДЕН)"} =====`);
  if (!t) continue;
  console.log("DESC:", t.description ?? "");
  console.log("SCHEMA:", JSON.stringify(t.inputSchema, null, 1));
}
