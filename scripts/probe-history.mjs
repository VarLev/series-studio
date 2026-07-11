/** Read-only: транзакции, последние генерации, воркспейсы, пресеты — ищем UUID 24bae836. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

async function mcpCall(name, args) {
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
          .filter(Boolean)
          .join("\n");
        return { text, isError: Boolean(res.isError) };
      } finally {
        await c.close().catch(() => {});
      }
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr;
}

const probes = [
  ["transactions", {}],
  ["show_generations", {}],
  ["list_workspaces", {}],
];
for (const [name, args] of probes) {
  console.log(`\n===== ${name} =====`);
  try {
    const r = await mcpCall(name, args);
    console.log(`isError=${r.isError}`);
    console.log(r.text.slice(0, 1800));
    if (r.text.includes("24bae836")) console.log(">>> НАЙДЕН 24bae836 в ответе этого инструмента! <<<");
  } catch (e) {
    console.log("FAILED:", e.message);
  }
}
