/**
 * The worker process: everything that shouldn't run inside a web request.
 *
 * - Applies database migrations at startup.
 * - Calls the app's cron routes on schedule (replaces Vercel Cron).
 * - Renders local-engine videos (needs OPENAI_API_KEY).
 * - Serves POST /download and POST /cut for the YouTube clip pipeline (replaces the Railway worker).
 * - Deletes cron_logs older than CRON_LOG_RETENTION_DAYS (default 14).
 *
 * Run with `npm run worker`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lt, sql } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { cron_logs } from "@/db/schema";
import { startCron } from "./cron";
import { requeueInterruptedRenders, startRenderLoop } from "./render";
import { cutClip, downloadSource } from "./youtube";

const PORT = Number(process.env.WORKER_PORT ?? 3001);
const SECRET = process.env.WORKER_SECRET || process.env.RAILWAY_WORKER_SECRET;
const APP_URL = (process.env.APP_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RETENTION_DAYS = Number(process.env.CRON_LOG_RETENTION_DAYS ?? 14);

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

// Same request and response shapes as the old Railway worker, so src/lib/worker-client.ts works
// unchanged. Jobs are accepted immediately and report back through the database.
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok" });
    if (req.method !== "POST" || (req.url !== "/download" && req.url !== "/cut")) {
      return send(res, 404, { error: "Not found" });
    }
    if (!SECRET) return send(res, 500, { error: "WORKER_SECRET not configured" });
    if (req.headers.authorization !== `Bearer ${SECRET}`) return send(res, 401, { error: "Unauthorized" });

    const body = await readJson(req);
    if (req.url === "/download") {
      const { youtubeUrl, sourceId } = body as { youtubeUrl?: string; sourceId?: string };
      if (!youtubeUrl || !sourceId) return send(res, 400, { error: "Missing required fields: youtubeUrl, sourceId" });
      send(res, 200, { accepted: true });
      void downloadSource(youtubeUrl, sourceId);
    } else {
      const { videoUrl, startTime, endTime, clipId } = body as {
        videoUrl?: string;
        startTime?: number;
        endTime?: number;
        clipId?: string;
      };
      if (!videoUrl || startTime === undefined || endTime === undefined || !clipId) {
        return send(res, 400, { error: "Missing required fields: videoUrl, startTime, endTime, clipId" });
      }
      send(res, 200, { accepted: true });
      void cutClip({ videoUrl, startTime, endTime, clipId });
    }
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Worker error" });
  }
});

async function pruneCronLogs(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const deleted = await db.delete(cron_logs).where(lt(cron_logs.started_at, cutoff)).returning({ id: cron_logs.id });
  if (deleted.length) console.log(`[worker] Deleted ${deleted.length} cron logs older than ${RETENTION_DAYS} days`);
}

async function main() {
  await runMigrations();
  await db.execute(sql`select 1`);
  console.log("[worker] Database ready");

  const requeued = await requeueInterruptedRenders();
  if (requeued) console.log(`[worker] Re-queued ${requeued} render(s) interrupted by the last shutdown`);

  const stops: (() => void)[] = [];
  if (process.env.CRON_SECRET) {
    stops.push(startCron({ appUrl: APP_URL, secret: process.env.CRON_SECRET }));
  } else {
    console.warn("[worker] CRON_SECRET is not set, so scheduled jobs (feeds, queue, status checks) won't run");
  }
  if (process.env.OPENAI_API_KEY) {
    stops.push(startRenderLoop());
  } else {
    console.warn("[worker] OPENAI_API_KEY is not set, so local-engine videos won't render");
  }

  await pruneCronLogs();
  const prune = setInterval(() => void pruneCronLogs().catch(console.error), 6 * 3_600_000);
  stops.push(() => clearInterval(prune));

  server.listen(PORT, () => console.log(`[worker] Listening on ${PORT}`));

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal}: shutting down`);
    stops.forEach((stop) => stop());
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  console.error("[worker] Failed to start:", error);
  await closeDb().catch(() => {});
  process.exit(1);
});
