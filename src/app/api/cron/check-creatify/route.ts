import { and, asc, eq, isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, type DbClient } from "@/db";
import { videos as videos_table } from "@/db/schema";
import {
  getAIShortsById,
  getLinkToVideoById,
  getLipsyncV2ById,
  isCreatifyConfigured,
  isJobComplete,
  isJobSuccessful,
} from "@/lib/creatify";
import { isLocalEngineOptions } from "@/lib/local-engine";
import { transferVideoToStorage, isStorageConfigured } from "@/lib/storage";
import { generateMultipleCaptions, isClaudeConfigured } from "@/lib/claude";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";
import type { Video, Platform } from "@/lib/supabase/types";

const MAX_CONCURRENT = 5; // Poll up to 5 videos at a time
const GENERATING_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// Default platforms to generate captions for
const DEFAULT_PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "facebook",
];

/**
 * Cron endpoint to poll Creatify job status for auto-generated videos.
 * Protected by CRON_SECRET header verification.
 *
 * This runs every 2 minutes and:
 * 1. Finds all videos with status='generating'
 * 2. Polls Creatify API for each video's job status
 * 3. On completion: downloads video, generates captions, sets approval_status='pending_review'
 * 4. On failure: marks video as failed
 */
export async function GET(request: NextRequest) {
  const logContext = await startCronLog("check-creatify");

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
    if (!isCreatifyConfigured()) {
      addError(logContext, "Creatify API not configured");
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Creatify API is not configured" },
        { status: 503 }
      );
    }

    // Fetch videos that need status checking
    // Only check auto_generated videos in 'generating' status
    let videos: Video[];
    try {
      videos = await db
        .select()
        .from(videos_table)
        .where(
          and(
            eq(videos_table.status, "generating"),
            isNotNull(videos_table.creatify_job_id)
          )
        )
        .orderBy(asc(videos_table.created_at))
        .limit(MAX_CONCURRENT);
    } catch (videosError) {
      console.error("Error fetching videos:", videosError);
      const errorMessage =
        videosError instanceof Error
          ? videosError.message
          : "Unknown database error";
      addError(logContext, `Failed to fetch videos: ${errorMessage}`);
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Failed to fetch videos" },
        { status: 500 }
      );
    }

    if (!videos || videos.length === 0) {
      await completeCronLog(logContext);
      return NextResponse.json({
        success: true,
        message: "No videos in generating status",
        checked: 0,
      });
    }

    const results: Array<{
      videoId: string;
      creatifyJobId: string;
      status: string;
      success: boolean;
      error?: string;
    }> = [];

    // Check each video's Creatify job status
    for (const video of videos) {
      try {
        const result = await checkVideoStatus(db, video);
        results.push({
          videoId: video.id,
          creatifyJobId: video.creatify_job_id!,
          status: result.status,
          success: true,
        });
        incrementProcessed(logContext);
      } catch (error) {
        console.error(`Error checking video ${video.id}:`, error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.push({
          videoId: video.id,
          creatifyJobId: video.creatify_job_id!,
          status: "error",
          success: false,
          error: errorMsg,
        });
        addError(logContext, `Video ${video.id}: ${errorMsg}`);
      }
    }

    const completedCount = results.filter(
      (r) => r.success && r.status === "completed"
    ).length;
    const failedCount = results.filter(
      (r) => r.success && r.status === "failed"
    ).length;
    const stillGeneratingCount = results.filter(
      (r) => r.success && r.status === "generating"
    ).length;
    const errorCount = results.filter((r) => !r.success).length;

    setSummary(logContext, "checked", results.length);
    setSummary(logContext, "completed", completedCount);
    setSummary(logContext, "failed", failedCount);
    setSummary(logContext, "stillGenerating", stillGeneratingCount);
    await completeCronLog(logContext);

    return NextResponse.json({
      success: true,
      checked: results.length,
      completed: completedCount,
      failed: failedCount,
      stillGenerating: stillGeneratingCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    console.error("Error in check-creatify cron:", error);
    addError(logContext, error instanceof Error ? error.message : "Unknown error");
    await completeCronLog(logContext, "error");
    return NextResponse.json(
      { error: "Failed to check Creatify status" },
      { status: 500 }
    );
  }
}

/**
 * Determine which Creatify API version was used for this video.
 */
function getApiVersion(video: Video): "link_to_video" | "lipsync_v2" | "ai_shorts" {
  const styleOptions = video.style_options as Record<string, unknown> | null;
  if (styleOptions?.apiVersion === "link_to_video") return "link_to_video";
  if (styleOptions?.apiVersion === "lipsync_v2") return "lipsync_v2";
  return "ai_shorts"; // Legacy default
}

/**
 * Check the Creatify job status for a single video and update accordingly.
 * Supports both legacy ai_shorts and new link_to_video/lipsync_v2 APIs.
 */
async function checkVideoStatus(
  database: DbClient,
  video: Video
): Promise<{ status: string }> {
  if (isLocalEngineOptions(video.style_options)) {
    return { status: video.status };
  }

  if (!video.creatify_job_id) {
    throw new Error("Video has no Creatify job ID");
  }

  const apiVersion = getApiVersion(video);
  console.log(
    `[check-creatify] Checking video ${video.id}, job ${video.creatify_job_id}, api: ${apiVersion}`
  );

  // Get status from the appropriate Creatify API endpoint
  let creatifyJob;
  switch (apiVersion) {
    case "link_to_video":
      creatifyJob = await getLinkToVideoById(video.creatify_job_id);
      break;
    case "lipsync_v2":
      creatifyJob = await getLipsyncV2ById(video.creatify_job_id);
      break;
    default:
      creatifyJob = await getAIShortsById(video.creatify_job_id);
      break;
  }

  if (!creatifyJob) {
    throw new Error(`Creatify job not found: ${video.creatify_job_id}`);
  }

  console.log(
    `[check-creatify] Job ${creatifyJob.id} status: ${creatifyJob.status}, progress: ${creatifyJob.progress}%`
  );

  // Check failed_reason even when status is non-terminal —
  // Creatify sets "Not enough credits" while status is still "pending"
  if (!isJobComplete(creatifyJob.status) && creatifyJob.failed_reason) {
    console.log(
      `[check-creatify] Job ${creatifyJob.id} has failed_reason="${creatifyJob.failed_reason}" while status=${creatifyJob.status}`
    );
    await handleFailedJob(database, video, creatifyJob);
    return { status: "failed" };
  }

  // Timeout: fail videos stuck generating too long
  if (!isJobComplete(creatifyJob.status)) {
    const elapsed = Date.now() - new Date(video.created_at).getTime();
    if (elapsed > GENERATING_TIMEOUT_MS) {
      console.log(
        `[check-creatify] Job ${creatifyJob.id} timed out after ${Math.round(elapsed / 60000)}min`
      );
      await database
        .update(videos_table)
        .set({
          status: "failed",
          error_message: `Timed out after ${Math.round(elapsed / 60000)} minutes (Creatify status: ${creatifyJob.status})`,
        })
        .where(eq(videos_table.id, video.id));
      return { status: "failed" };
    }
    return { status: "generating" };
  }

  // Job is complete - determine if successful or failed
  if (isJobSuccessful(creatifyJob.status)) {
    // Job succeeded - download video, generate captions, update status
    await handleSuccessfulJob(database, video, creatifyJob);
    return { status: "completed" };
  } else {
    // Job failed - update video status
    await handleFailedJob(database, video, creatifyJob);
    return { status: "failed" };
  }
}

/**
 * Handle a successfully completed Creatify job.
 * Downloads video, generates captions, and sets to pending_review.
 */
async function handleSuccessfulJob(
  database: DbClient,
  video: Video,
  creatifyJob: {
    video_output: string | null;
    duration: number;
    failed_reason: string;
  }
): Promise<void> {
  console.log(`[check-creatify] Processing successful job for video ${video.id}`);

  let finalVideoUrl = video.video_url;
  let creatifyVideoUrl = video.creatify_video_url;

  // Download and store video if we have a Creatify URL
  if (creatifyJob.video_output) {
    creatifyVideoUrl = creatifyJob.video_output;

    // Try to transfer to storage
    const storageConfigured = await isStorageConfigured();

    if (storageConfigured) {
      try {
        console.log(
          `[check-creatify] Transferring video to storage...`
        );
        finalVideoUrl = await transferVideoToStorage(
          creatifyJob.video_output,
          video.id
        );
        console.log(
          `[check-creatify] Video transferred successfully: ${finalVideoUrl}`
        );
      } catch (storageError) {
        console.error(
          `[check-creatify] Failed to transfer video to storage:`,
          storageError
        );
        // Fall back to Creatify URL
        finalVideoUrl = creatifyJob.video_output;
      }
    } else {
      console.warn(
        `[check-creatify] Storage not configured, using Creatify URL directly`
      );
      finalVideoUrl = creatifyJob.video_output;
    }
  }

  // Generate captions if Claude is configured
  let generatedCaptions: Record<string, string> | null = null;

  if (isClaudeConfigured() && video.script) {
    try {
      console.log(`[check-creatify] Generating captions for video ${video.id}`);
      const captionResults = await generateMultipleCaptions(
        video.script,
        DEFAULT_PLATFORMS
      );

      // Extract just the caption strings
      generatedCaptions = {};
      for (const [platform, result] of Object.entries(captionResults)) {
        generatedCaptions[platform] = result.caption;
      }

      console.log(
        `[check-creatify] Generated captions for ${Object.keys(generatedCaptions).length} platforms`
      );
    } catch (captionError) {
      console.error(
        `[check-creatify] Failed to generate captions:`,
        captionError
      );
      // Continue without captions - they can be generated manually
    }
  }

  // Update video record
  const updatePayload: Partial<typeof videos_table.$inferInsert> = {
    status: "completed",
    video_url: finalVideoUrl,
    creatify_video_url: creatifyVideoUrl,
    duration_seconds: creatifyJob.duration ?? video.duration_seconds,
    approval_status: "pending_review",
  };

  if (generatedCaptions) {
    updatePayload.generated_captions = generatedCaptions;
  }

  await database
    .update(videos_table)
    .set(updatePayload)
    .where(eq(videos_table.id, video.id));

  console.log(
    `[check-creatify] Video ${video.id} completed and set to pending_review`
  );
}

/**
 * Handle a failed Creatify job.
 */
async function handleFailedJob(
  database: DbClient,
  video: Video,
  creatifyJob: { failed_reason: string }
): Promise<void> {
  console.log(
    `[check-creatify] Processing failed job for video ${video.id}: ${creatifyJob.failed_reason}`
  );

  await database
    .update(videos_table)
    .set({
      status: "failed",
      error_message: creatifyJob.failed_reason || "Creatify job failed",
    })
    .where(eq(videos_table.id, video.id));

  console.log(`[check-creatify] Video ${video.id} marked as failed`);
}
