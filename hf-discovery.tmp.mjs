// Дожидаемся завершения тестового job — формат completed-ответа. Ретраи на всё.
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const JOB = "48722638-f5f1-4949-bda9-f011a6d0f74b";
const db = new PGlite("C:/Users/Lenov/Desktop/AI/AIDirector/series-studio/.data/pglite");
const res = await db.query("SELECT value FROM settings WHERE key = 'hf_mcp_tokens'");
await db.close();
const tokens = JSON.parse(res.rows[0].value);

async function connect() {
  for (let i = 0; i < 5; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL("https://mcp.higgsfield.ai/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      });
      const client = new Client({ name: "series-studio", version: "1.0.0" });
      await client.connect(transport);
      return client;
    } catch (e) { if (i === 4) throw e; await new Promise(r => setTimeout(r, 1000)); }
  }
}
const textOf = (r) => (Array.isArray(r.content) ? r.content : []).map(x => x.text ?? "").join("\n") || JSON.stringify(r.structuredContent ?? null);

for (let i = 0; i < 20; i++) {
  let t = "";
  try {
    const client = await connect();
    const st = await client.callTool({ name: "job_status", arguments: { jobId: JOB, sync: true, raw_data: false } });
    t = textOf(st);
    await client.close().catch(() => {});
  } catch (e) {
    console.log(`poll ${i}: network fail (${String(e).slice(0, 80)})`);
    await new Promise(r => setTimeout(r, 2000));
    continue;
  }
  console.log(`--- poll ${i}:\n${t.slice(0, 2000)}\n`);
  if (/completed|failed|nsfw|cancel/i.test(t)) break;
}
