/** Сверка show_generations (Higgsfield) с таблицей generations — ищем оплаченные
 * задачи, потерянные приложением. Сервер должен быть остановлен. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
const gens = await db.query(`select provider_job_id from generations where provider_job_id is not null`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);
const known = new Set(gens.rows.map((r) => r.provider_job_id));

async function call(name, args) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL("https://mcp.higgsfield.ai/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      });
      const c = new Client({ name: "probe", version: "1.0.0" });
      await c.connect(transport);
      try {
        const res = await c.callTool({ name, arguments: args });
        const text = (Array.isArray(res.content) ? res.content : [])
          .map((b) => (b && typeof b === "object" && "text" in b ? String(b.text) : ""))
          .filter(Boolean).join("\n");
        return { text, isError: Boolean(res.isError), structured: res.structuredContent };
      } finally { await c.close().catch(() => {}); }
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw lastErr;
}

const r = await call("show_generations", {});
// формат: items[N]{id,type,status,model,url,createdAt}
const lines = r.text.split("\n").filter((l) => /^\s+[0-9a-f]{8}-/.test(l));
console.log("=== последние генерации Higgsfield (video) ===");
for (const line of lines) {
  const [id, type, status, model] = line.trim().split(",");
  if (type !== "video") continue;
  const mark = known.has(id) ? "  (в приложении)" : "  << ОРФАН — нет в приложении";
  console.log(`${id} | ${model} | ${status}${mark}`);
}
