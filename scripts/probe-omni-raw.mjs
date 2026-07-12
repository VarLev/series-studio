/** Сырой payload недавних задач (raw_data) — как UI передаёт Omni+elements. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

async function call(name, args) {
  let lastErr;
  for (let i = 0; i < 10; i++) {
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
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 6000)); }
  }
  throw lastErr;
}

const g = await call("show_generations", {});
const lines = (g.text.match(/^\s+[0-9a-f-]{36},video[^\n]*/gm) ?? []).slice(0, 6);
console.log("=== последние видео-задачи ===");
console.log(lines.join("\n"));

for (const line of lines.slice(0, 4)) {
  const id = line.trim().split(",")[0];
  console.log(`\n========== raw ${id} ==========`);
  try {
    const r = await call("job_status", { jobId: id, raw_data: true });
    const raw = r.structured ? JSON.stringify(r.structured) : r.text;
    // модель, elements, medias — самое важное
    const trimmed = raw
      .replace(/https?:\/\/[^\s"',)]+/g, "<url>")
      .slice(0, 1800);
    console.log(trimmed);
  } catch (e) { console.log("FAILED:", e.message.slice(0, 80)); }
}
