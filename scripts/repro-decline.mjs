/** Полный повтор пути приложения ВКЛЮЧАЯ авто-отклонение пресета:
 * uploads → submit (придёт пресет-notice) → retry c declined_preset_id.
 * Реальный сабмит ~4 кр при успехе. Сервер должен быть остановлен. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const db = new PGlite(".data/pglite");
const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
const promptRow = await db.query(
  `select text from prompts where shot_id = $1 order by version desc limit 1`,
  ["1edbe030-9125-461e-96c5-5016510ce188"],
);
const refRows = await db.query(
  `select entity_id, storage_path from "references" where entity_id in ($1,$2)`,
  ["01162597-ff1f-40d2-841a-c143a1b68f1b", "38ec3795-1478-4cc4-9bb8-3cf991d32309"],
);
await db.close();
const tokens = JSON.parse(tokRow.rows[0].value);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

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
        return { text, isError: Boolean(res.isError) };
      } finally { await c.close().catch(() => {}); }
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw lastErr;
}

async function upload(path) {
  const data = await readFile(`.data/storage/${path}`);
  const ct = path.endsWith(".png") ? "image/png" : "image/jpeg";
  const up = await call("media_upload", { method: "upload_url", filename: `ref.${ct.includes("png") ? "png" : "jpg"}`, content_type: ct });
  const uploadUrl = up.text.match(/https?:\/\/[^\s"']+/)?.[0];
  const mediaId = up.text.match(UUID_RE)?.[0];
  await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: new Uint8Array(data) });
  await call("media_confirm", { type: "image", media_id: mediaId });
  return mediaId;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let prompt = promptRow.rows[0].text;
[["simon", "@image1"], ["craig", "@image2"]].forEach(([bare, token]) => {
  prompt = prompt.replace(new RegExp(`@${esc(bare)}(?![\\w-])`, "gi"), token);
});

const byEntity = Object.fromEntries(refRows.rows.map((r) => [r.entity_id, r.storage_path]));
const simonId = await upload(byEntity["01162597-ff1f-40d2-841a-c143a1b68f1b"]);
const craigId = await upload(byEntity["38ec3795-1478-4cc4-9bb8-3cf991d32309"]);
console.log(`uploaded: ${simonId.slice(0, 8)}, ${craigId.slice(0, 8)}`);

const params = {
  model: "seedance_2_0_mini",
  prompt,
  aspect_ratio: "9:16",
  duration: 4,
  resolution: "480p",
  medias: [
    { value: simonId, role: "image_references" },
    { value: craigId, role: "image_references" },
  ],
};

console.log("\n=== submit #1 (ожидаем пресет-notice) ===");
const first = await call("generate_video", { params }, false);
console.log(`isError=${first.isError} | ${first.text.slice(0, 120).replace(/\n/g, " ")}`);
const presetId = first.text.match(/declined_preset_id:\s*"?([0-9a-f-]{36})/i)?.[1] ?? first.text.match(UUID_RE)?.[0];
console.log(`presetId: ${presetId}`);

console.log("\n=== submit #2 (declined_preset_id) ===");
const second = await call("generate_video", { params: { ...params, declined_preset_id: presetId } }, false);
console.log(`isError=${second.isError}`);
console.log(second.text.slice(0, 500));
