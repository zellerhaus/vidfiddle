import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { cron_logs, generation_queue, rss_feeds } from "@/db/schema";

export async function GET() {
  try {
    // Fetch last cron runs for each type
    const [checkFeedsLog, processQueueLog, checkCreatifyLog] = await Promise.all([
      db
        .select()
        .from(cron_logs)
        .where(eq(cron_logs.cron_type, "check-feeds"))
        .orderBy(desc(cron_logs.started_at))
        .limit(1),
      db
        .select()
        .from(cron_logs)
        .where(eq(cron_logs.cron_type, "process-queue"))
        .orderBy(desc(cron_logs.started_at))
        .limit(1),
      db
        .select()
        .from(cron_logs)
        .where(eq(cron_logs.cron_type, "check-creatify"))
        .orderBy(desc(cron_logs.started_at))
        .limit(1),
    ]);

    // Fetch queue counts
    const [pendingQueue, processingQueue, completedQueue, failedQueue] = await Promise.all([
      db.$count(generation_queue, eq(generation_queue.status, "pending")),
      db.$count(generation_queue, eq(generation_queue.status, "processing")),
      db.$count(generation_queue, eq(generation_queue.status, "completed")),
      db.$count(generation_queue, eq(generation_queue.status, "failed")),
    ]);

    // Fetch recent errors from cron_logs
    const recentErrors = await db
      .select({
        cron_type: cron_logs.cron_type,
        started_at: cron_logs.started_at,
        errors: cron_logs.errors,
        status: cron_logs.status,
      })
      .from(cron_logs)
      .where(eq(cron_logs.status, "error"))
      .orderBy(desc(cron_logs.started_at))
      .limit(10);

    // Fetch feeds with auto mode status
    const feeds = await db
      .select({
        id: rss_feeds.id,
        title: rss_feeds.title,
        url: rss_feeds.url,
        auto_mode_enabled: rss_feeds.auto_mode_enabled,
        auto_videos_per_post: rss_feeds.auto_videos_per_post,
        last_checked_at: rss_feeds.last_checked_at,
      })
      .from(rss_feeds)
      .orderBy(desc(rss_feeds.created_at));

    return NextResponse.json({
      lastCronRuns: {
        checkFeeds: checkFeedsLog[0] ?? null,
        processQueue: processQueueLog[0] ?? null,
        checkCreatify: checkCreatifyLog[0] ?? null,
      },
      queueCounts: {
        pending: pendingQueue ?? 0,
        processing: processingQueue ?? 0,
        completed: completedQueue ?? 0,
        failed: failedQueue ?? 0,
      },
      recentErrors: recentErrors ?? [],
      feeds: feeds ?? [],
    });
  } catch (error) {
    console.error("Error fetching auto mode status:", error);
    return NextResponse.json(
      { error: "Failed to fetch auto mode status" },
      { status: 500 }
    );
  }
}
