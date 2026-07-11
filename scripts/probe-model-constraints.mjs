import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

async function raw(name, args) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL("https://mcp.higgsfield.ai/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      });
      const c = new Client({ name: "probe", version: "1.0.0" });
      await c.connect(transport);
      try { return await c.callTool({ name, arguments: args }); }
      finally { await c.close().catch(() => {}); }
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 900 * (i + 1))); }
  }
  throw lastErr;
}

for (const model_id of ["seedance_2_0", "kling3_0"]) {
  console.log(`\n========== get ${model_id} (RAW) ==========`);
  try {
    const res = await raw("models_explore", { action: "get", model_id });
    console.log("keys:", Object.keys(res));
    console.log("content:", JSON.stringify(res.content)?.slice(0, 3500));
    if (res.structuredContent) console.log("structured:", JSON.stringify(res.structuredContent).slice(0, 3500));
  } catch (e) { console.log("FAILED:", e.message); }
}
