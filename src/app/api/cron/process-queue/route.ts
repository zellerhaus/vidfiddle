import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { isClaudeConfigured } from "@/lib/claude";
import { isCreatifyConfigured } from "@/lib/creatify";
import { isLocalEngineConfigured } from "@/lib/local-engine";
import { claimQueueItems, loadQueueSettings, processQueueItem } from "@/lib/generation-queue";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";
import type { GenerationQueueItem } from "@/lib/supabase/types";

const MAX_CONCURRENT = 10; // Process up to 10 items at a time

/**
 * Cron endpoint to process the generation queue.
 * Protected by CRON_SECRET header verification.
 *
 * This runs on the worker's schedule (daily by default) and:
 * 1. Claims up to MAX_CONCURRENT due items
 * 2. For each: generate script using defaults, queue or call the configured renderer
 * 3. Creates video record with auto_generated=true
 * 4. Updates queue status on completion/failure
 */
export async function GET(request: NextRequest) {
  const logContext = await startCronLog("process-queue");

  try {
    // Verify CRON_SECRET (Vercel sends it as Authorization: Bearer <secret>)
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.error("CRON_SECRET environment variable not configured");
      addError(logContext, "CRON_SECRET not configured");
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const cronSecret =
      authHeader?.replace("Bearer ", "") ||
      request.headers.get("x-cron-secret");

    if (cronSecret !== expectedSecret) {
      addError(logContext, "Unauthorized request");
      await completeCronLog(logContext, "error");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check required services are configured
    if (!isClaudeConfigured()) {
      addError(logContext, "Claude API not configured");
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Claude API is not configured" },
        { status: 503 }
      );
    }

    // Video defaults and the default brand guideline
    const { defaults, brandGuideline } = await loadQueueSettings(db);
    const apiMethod = defaults.apiMethod || "ai_shorts";

    if (apiMethod === "local") {
      if (!isLocalEngineConfigured()) {
        addError(logContext, "Local engine not configured");
        await completeCronLog(logContext, "error");
        return NextResponse.json(
          { error: "Local engine is not configured. Add OPENAI_API_KEY to render videos locally." },
          { status: 503 }
        );
      }
    } else if (!isCreatifyConfigured()) {
      addError(logContext, "Creatify API not configured");
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Creatify API is not configured" },
        { status: 503 }
      );
    }

    // Get next pending queue items
    let queueItems: GenerationQueueItem[];
    try {
      queueItems = await claimQueueItems(db, { limit: MAX_CONCURRENT });
    } catch (queueError) {
      console.error("Error fetching queue items:", queueError);
      const errorMessage =
        queueError instanceof Error ? queueError.message : "Unknown database error";
      addError(logContext, `Failed to fetch queue items: ${errorMessage}`);
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Failed to fetch queue items" },
        { status: 500 }
      );
    }

    if (!queueItems || queueItems.length === 0) {
      await completeCronLog(logContext);
      return NextResponse.json({
        success: true,
        message: "No pending queue items",
        processed: 0,
      });
    }

    const results: Array<{
      queueId: string;
      videoId?: string;
      success: boolean;
      error?: string;
    }> = [];

    // Process each queue item
    for (const item of queueItems) {
      try {
        const result = await processQueueItem(db, item, defaults, brandGuideline);
        results.push({
          queueId: item.id,
          videoId: result.videoId,
          success: true,
        });
        incrementProcessed(logContext);
      } catch (error) {
        console.error(`Error processing queue item ${item.id}:`, error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.push({
          queueId: item.id,
          success: false,
          error: errorMsg,
        });
        addError(logContext, `Queue item ${item.id}: ${errorMsg}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    setSummary(logContext, "processed", results.length);
    setSummary(logContext, "succeeded", successCount);
    setSummary(logContext, "failed", failureCount);
    await completeCronLog(logContext);

    return NextResponse.json({
      success: true,
      processed: results.length,
      succeeded: successCount,
      failed: failureCount,
      results,
    });
  } catch (error) {
    console.error("Error in process-queue cron:", error);
    addError(logContext, error instanceof Error ? error.message : "Unknown error");
    await completeCronLog(logContext, "error");
    return NextResponse.json(
      { error: "Failed to process queue" },
      { status: 500 }
    );
  }
}
