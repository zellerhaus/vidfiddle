/**
 * The worker process: everything that shouldn't run inside a web request.
 *
 * - Applies database migrations at startup.
 * - Calls the app's cron routes on schedule (replaces Vercel Cron).
 * - Renders local-engine videos (needs OPENAI_API_KEY).
 * - Serves GET /health, which reports healthy once migrations have run.
 * - Deletes cron_logs older than CRON_LOG_RETENTION_DAYS (default 14).
 *
 * Run with `npm run worker`.
 */
import { createServer } from "node:http";
import { lt, sql } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { cron_logs } from "@/db/schema";
import { startCron } from "./cron";
import { requeueInterruptedRenders, startRenderLoop } from "./render";

const PORT = Number(process.env.WORKER_PORT ?? 3001);
const APP_URL = (process.env.APP_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RETENTION_DAYS = Number(process.env.CRON_LOG_RETENTION_DAYS ?? 14);

// Docker Compose starts the app once this answers, so the app never sees an unmigrated database.
const server = createServer((req, res) => {
  const ok = req.method === "GET" && req.url === "/health";
  res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify(ok ? { status: "ok" } : { error: "Not found" }));
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
