/** Схемы и описания generate_video / job_status — как правильно вызывать и что вернётся. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

let tools;
for (let i = 0; i < 3 && !tools; i++) {
  try {
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.higgsfield.ai/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    });
    const c = new Client({ name: "probe", version: "1.0.0" });
    await c.connect(transport);
    tools = (await c.listTools()).tools;
    await c.close().catch(() => {});
  } catch (e) {
    if (i === 2) throw e;
    await new Promise((r) => setTimeout(r, 800));
  }
}

for (const t of tools) {
  if (!/^(generate_video|job_status|jobs?_|generate_image)/.test(t.name)) continue;
  console.log(`\n===== ${t.name} =====`);
  console.log("DESC:", (t.description ?? "").slice(0, 1500));
  console.log("SCHEMA:", JSON.stringify(t.inputSchema).slice(0, 2000));
}
console.log("\nALL TOOL NAMES:", tools.map((t) => t.name).join(", "));
