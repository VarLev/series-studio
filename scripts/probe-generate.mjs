/**
 * Живой формат ответов generate_video (get_cost:true — задача НЕ создаётся,
 * кредиты не списываются). Сервер приложения должен быть остановлен.
 */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

async function mcpCall(name, args) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
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

const cases = [
  ["kling3_0 9s std 9:16", { model: "kling3_0", prompt: "test", aspect_ratio: "9:16", duration: 9, mode: "std", get_cost: true }],
  ["seedance_2_0_mini 9s 720p", { model: "seedance_2_0_mini", prompt: "test", aspect_ratio: "9:16", duration: 9, resolution: "720p", get_cost: true }],
  ["seedance_2_0 9s 720p", { model: "seedance_2_0", prompt: "test", aspect_ratio: "9:16", duration: 9, resolution: "720p", get_cost: true }],
  ["seedance_2_0 10s 1080p", { model: "seedance_2_0", prompt: "test", aspect_ratio: "9:16", duration: 10, resolution: "1080p", get_cost: true }],
];
for (const [label, params] of cases) {
  console.log(`=== get_cost ${label} ===`);
  try {
    const r = await mcpCall("generate_video", { params });
    console.log(`isError=${r.isError}`);
    console.log(r.text.slice(0, 500));
  } catch (e) {
    console.log("FAILED:", e.message);
  }
}
