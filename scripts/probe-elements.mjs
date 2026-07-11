/**
 * Валидация Elements: создать элемент из фото Simon → сабмит Seedance Mini и
 * Kling 3.0 с плейсхолдером <<<element_id>>> в промпте. Сервер остановлен.
 */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
const cacheRow = await db.query(`select key, value from settings where key like 'hf_media_%'`);
const refRow = await db.query(
  `select id, storage_path from "references" where entity_id = $1 limit 1`,
  ["01162597-ff1f-40d2-841a-c143a1b68f1b"],
);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function call(name, args, retry = true) {
  let lastErr;
  const n = retry ? 3 : 1;
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
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw lastErr;
}

// загрузка Simon (нужен и media_id, и https-URL без query)
void cacheRow;
const data = await readFile(`.data/storage/${refRow.rows[0].storage_path}`);
const up = await call("media_upload", { method: "upload_url", filename: "simon.png", content_type: "image/png" });
const uploadUrl = up.text.match(/https?:\/\/[^\s"']+/)?.[0];
const mediaId = up.text.match(UUID_RE)?.[0];
await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array(data) });
await call("media_confirm", { type: "image", media_id: mediaId });
const mediaUrl = uploadUrl.split("?")[0];
console.log(`Simon media_id: ${mediaId}`);
console.log(`Simon mediaUrl: ${mediaUrl}`);

console.log("\n=== create element Simon ===");
const el = await call("show_reference_elements", {
  action: "create",
  name: "Simon",
  category: "character",
  medias: [{ id: mediaId, url: mediaUrl, type: "media_input" }],
});
console.log(`isError=${el.isError}`);
console.log((el.text || JSON.stringify(el.structured)).slice(0, 600));
const elementId = (el.text.match(new RegExp(UUID_RE.source, "gi")) ?? [])[0] ??
  el.structured?.id ?? el.structured?.element_id;
console.log(`elementId: ${elementId}`);
if (!elementId) process.exit(1);

const prompt = `<<<${elementId}>>> stands in a dim room near a window at dusk and slowly turns his head to the camera. Cinematic, vertical 9:16. No subtitles.`;

console.log("\n=== seedance mini 4s 480p with element placeholder ===");
const sub1 = await call("generate_video", {
  params: { model: "seedance_2_0_mini", prompt, aspect_ratio: "9:16", duration: 4, resolution: "480p" },
}, false);
console.log(`isError=${sub1.isError} | ${sub1.text.slice(0, 220).replace(/\n/g, " ")}`);

console.log("\n=== kling3_0 get_cost 3s std sound off ===");
const kcost = await call("generate_video", {
  params: { model: "kling3_0", prompt, aspect_ratio: "9:16", duration: 3, mode: "std", sound: "off", get_cost: true },
});
console.log(`isError=${kcost.isError} | ${kcost.text.slice(0, 150)}`);

console.log("\n=== kling3_0 REAL submit 3s std sound off with element ===");
const sub2 = await call("generate_video", {
  params: { model: "kling3_0", prompt, aspect_ratio: "9:16", duration: 3, mode: "std", sound: "off" },
}, false);
console.log(`isError=${sub2.isError} | ${sub2.text.slice(0, 300).replace(/\n/g, " ")}`);
