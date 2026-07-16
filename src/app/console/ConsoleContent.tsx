import { inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDb, references } from "@/lib/db";
import { getFileUrl } from "@/lib/storage";
import { readModelLog } from "@/lib/modelLog";
import { getT } from "@/lib/i18n-server";
import ConsoleClient, { type LogRowView } from "@/components/console/ConsoleClient";

interface RefDescriptor {
  id: string;
  caption?: string;
  role?: string | null;
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Тело «Консоли» — общее для полной страницы (/console) и правой панели
 * (@panel/(.)console). В панели шапку рисует слайдер, поэтому ConsoleClient
 * зовётся с bare: свою обвязку он тогда не рендерит.
 */
export default async function ConsoleContent({ bare = false }: { bare?: boolean }) {
  await requireAuth();
  const db = await getDb();
  const t = await getT();
  const rows = await readModelLog(200);

  // прикреплённые референсы всех записей → одним запросом резолвим превью
  const refDescriptors = rows.map((r) => safeParse<RefDescriptor[]>(r.refsJson, []));
  const allRefIds = [...new Set(refDescriptors.flat().map((d) => d.id).filter(Boolean))];
  const refRows = allRefIds.length
    ? await db.select().from(references).where(inArray(references.id, allRefIds))
    : [];
  const refInfoById = new Map<string, { url: string; caption: string }>();
  await Promise.all(
    refRows.map(async (rr) => {
      refInfoById.set(rr.id, { url: await getFileUrl(rr.storagePath), caption: rr.caption });
    }),
  );

  const items: LogRowView[] = rows.map((r, i) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    channel: r.channel as LogRowView["channel"],
    kind: r.kind,
    provider: r.provider,
    model: r.model,
    status: r.status as LogRowView["status"],
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    durationMs: r.durationMs,
    request: safeParse<Record<string, unknown>>(r.requestJson, {}),
    response: safeParse<Record<string, unknown>>(r.responseJson, {}),
    refs: refDescriptors[i].map((d) => ({
      id: d.id,
      url: refInfoById.get(d.id)?.url ?? null,
      caption: d.caption || refInfoById.get(d.id)?.caption || "",
      role: d.role ?? null,
    })),
  }));

  return (
    <ConsoleClient
      items={items}
      bare={bare}
      title={t("Консоль", "Console")}
      subtitle={t(
        "Что и в каком виде отправлено в модели и что пришло в ответ.",
        "What was sent to the models and what came back — request & response.",
      )}
    />
  );
}
