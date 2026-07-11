/**
 * Контрольный живой сабмит: seedance_2_0_mini 4с 480p (~4 кр) — снять точный
 * формат ответа generate_video и провести job до терминального статуса.
 */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);

async function mcpCall(name, args, retry = true) {
  let lastErr;
  const attempts = retry ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
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

const params = {
  model: "seedance_2_0_mini",
  prompt: "A small orange cat walks across a wooden floor, soft daylight.",
  aspect_ratio: "9:16",
  duration: 4,
  resolution: "480p",
};

console.log("=== balance before ===");
console.log((await mcpCall("balance", {})).text);

console.log("=== get_cost ===");
console.log((await mcpCall("generate_video", { params: { ...params, get_cost: true } })).text);

console.log("=== REAL SUBMIT (raw response) ===");
const sub = await mcpCall("generate_video", { params }, false);
console.log(`isError=${sub.isError}`);
console.log("--- full text ---");
console.log(sub.text);
console.log("--- uuids in text ---");
console.log([...sub.text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0]).join("\n") || "(none)");

const jobId = sub.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
if (jobId && !sub.isError) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const st = await mcpCall("job_status", { jobId, sync: true });
    console.log(`=== job_status #${i + 1} (isError=${st.isError}) ===`);
    console.log(st.text.slice(0, 500));
    if (/completed|failed|error|nsfw/i.test(st.text) && !/in_progress|queued/i.test(st.text)) break;
  }
  console.log("=== balance after ===");
  console.log((await mcpCall("balance", {})).text);
}
