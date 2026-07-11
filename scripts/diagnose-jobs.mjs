/**
 * Диагностика зависших видео-задач: читает generations из PGlite (сервер должен
 * быть ОСТАНОВЛЕН) и спрашивает Higgsfield MCP job_status по каждому job id.
 * Токены не печатает. Запуск: node scripts/diagnose-jobs.mjs <shotId>
 */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
const shotId = process.argv[2];
if (!shotId) {
  console.error("usage: node scripts/diagnose-jobs.mjs <shotId>");
  process.exit(1);
}

const db = new PGlite(".data/pglite");

const gens = await db.query(
  `select id, model, status, provider, provider_job_id, created_at, error, params_json
   from generations where shot_id = $1 order by created_at desc limit 6`,
  [shotId],
);
console.log("=== generations rows ===");
for (const g of gens.rows) {
  const p = JSON.parse(g.params_json || "{}");
  console.log(
    `- ${g.model} | status=${g.status} | jobId=${g.provider_job_id ?? "NULL"} | created=${g.created_at?.toISOString?.() ?? g.created_at} | est=${p.estimate} | err=${g.error || "-"}`,
  );
}

const tokRow = await db.query(`select value from settings where key = 'hf_mcp_tokens'`);
const cliRow = await db.query(`select value from settings where key = 'hf_mcp_client'`);
await db.close();

if (!tokRow.rows.length) {
  console.log("=== MCP: NOT CONNECTED (нет hf_mcp_tokens) ===");
  process.exit(0);
}
let tokens = JSON.parse(tokRow.rows[0].value);
const client_id = cliRow.rows.length ? JSON.parse(cliRow.rows[0].value).client_id : null;
console.log(
  `=== tokens: expires_at=${new Date(tokens.expires_at).toISOString()} (${tokens.expires_at > Date.now() ? "VALID" : "EXPIRED"}), refresh=${tokens.refresh_token ? "yes" : "no"} ===`,
);

async function fetchRetry(url, init, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

if (Date.now() >= tokens.expires_at - 60_000) {
  if (!tokens.refresh_token || !client_id) {
    console.log("токен истёк, refresh невозможен — нужно переподключение в настройках");
    process.exit(0);
  }
  const res = await fetchRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.log(`refresh FAILED: ${res.status} ${body.error ?? ""}`);
    process.exit(0);
  }
  tokens = { access_token: body.access_token };
  console.log("refresh OK (токен обновлён только в памяти скрипта)");
}

async function mcpCall(name, args) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      });
      const c = new Client({ name: "diagnose", version: "1.0.0" });
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

console.log("=== balance ===");
try {
  const b = await mcpCall("balance", {});
  console.log(b.text);
} catch (e) {
  console.log("balance FAILED:", e.message);
}

for (const g of gens.rows) {
  if (!g.provider_job_id) continue;
  console.log(`=== job_status ${g.model} ${g.provider_job_id} ===`);
  try {
    const s = await mcpCall("job_status", { jobId: g.provider_job_id });
    console.log(`isError=${s.isError}`);
    console.log(s.text.slice(0, 600));
  } catch (e) {
    console.log("job_status FAILED:", e.message);
  }
}
