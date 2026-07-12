/** kling_o3_image_reference (= «Kling 3.0 Omni» из UI): полные params задачи
 * заказчика + get_cost + пробный сабмит с элементом. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function call(name, args, retry = true) {
  let lastErr;
  const n = retry ? 8 : 1;
  for (let i = 0; i < n; i++) {
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

// 1) полные params задачи заказчика (без промпта и url)
const raw = await call("job_status", { jobId: "d1a6323f-9c96-43c5-89cd-dbbe0b4a9e1d", raw_data: true });
const payload = raw.structured?.raw_data ?? JSON.parse(raw.text || "{}").raw_data;
const params = payload?.params ?? {};
const { prompt: _p, reference_elements: re, ...rest } = params;
console.log("=== params задачи Omni (без промпта) ===");
console.log(JSON.stringify(rest));
console.log("reference_elements count:", (re ?? []).length, "ids:", (re ?? []).map((e) => e.id?.slice(0, 8)).join(","));

// 2) get_cost для kling_o3_image_reference
console.log("\n=== get_cost kling_o3_image_reference 4s 9:16 ===");
const cost = await call("generate_video", {
  params: {
    model: "kling_o3_image_reference",
    prompt: "test",
    aspect_ratio: "9:16",
    duration: 4,
    get_cost: true,
  },
});
console.log(`isError=${cost.isError} | ${cost.text.slice(0, 250)}`);

// 3) если стоимость адекватная — пробный сабмит с элементом Simon
if (!cost.isError && /credits/i.test(cost.text)) {
  const m = cost.text.match(/([\d.]+)\s*credits/i);
  const credits = m ? Number(m[1]) : 999;
  console.log(`cost: ${credits} credits`);
  if (credits <= 20) {
    const sub = await call("generate_video", {
      params: {
        model: "kling_o3_image_reference",
        prompt:
          "<<<6a7c47d4-1274-4fe0-b255-2742580b1bd9>>> stands in a dim room near a window at dusk and slowly turns his head to the camera. Cinematic, vertical 9:16. No subtitles.",
        aspect_ratio: "9:16",
        duration: 4,
      },
    }, false);
    console.log(`\n=== SUBMIT isError=${sub.isError} ===`);
    console.log(sub.text.slice(0, 300));
    const jobId = /submitted\s+\d+\s+job/i.test(sub.text) ? sub.text.match(UUID_RE)?.[0] : null;
    if (jobId) {
      await new Promise((r) => setTimeout(r, 8000));
      const st = await call("job_status", { jobId, raw_data: true });
      const jp = st.structured?.raw_data ?? {};
      console.log(`job_set_type: ${jp.job_set_type} | display: ${jp.display_name} | status: ${jp.status}`);
      console.log(`reference_elements: ${(jp.params?.reference_elements ?? []).length}`);
    }
  } else {
    console.log("слишком дорого для автотеста — сабмит пропущен");
  }
}
