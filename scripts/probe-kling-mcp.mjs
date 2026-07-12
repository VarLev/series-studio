/** Kling MCP: схемы инструментов + остаток who_am_i + кредиты. Сервер остановлен. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'kling_mcp_tokens'`);
await db.close();
if (!tokRow.rows.length) { console.log("NOT CONNECTED"); process.exit(1); }
const tokens = JSON.parse(tokRow.rows[0].value);

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

// 1) схемы инструментов
const tools = await withClient(async (c) => (await c.listTools()).tools);
console.log("=== tools ===");
for (const t of tools) console.log(`- ${t.name}`);
for (const name of ["image_to_video", "text_to_video", "file_upload", "query_tasks", "query_membership_and_credits"]) {
  const t = tools.find((x) => x.name === name);
  if (!t) continue;
  console.log(`\n===== ${name} =====`);
  console.log("DESC:", (t.description ?? "").slice(0, 400));
  console.log("SCHEMA:", JSON.stringify(t.inputSchema).slice(0, 2200));
}

// 2) кредиты
async function call(name, args) {
  return withClient(async (c) => {
    const res = await c.callTool({ name, arguments: args });
    const text = (Array.isArray(res.content) ? res.content : [])
      .map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : ""))
      .filter(Boolean).join("\n");
    return { text, isError: Boolean(res.isError), structured: res.structuredContent };
  });
}
console.log("\n===== query_membership_and_credits =====");
try {
  const r = await call("query_membership_and_credits", {});
  console.log((r.text || JSON.stringify(r.structured)).slice(0, 800));
} catch (e) { console.log("FAILED:", e.message.slice(0, 100)); }
