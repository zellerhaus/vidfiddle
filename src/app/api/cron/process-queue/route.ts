import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, type DbClient } from "@/db";
import {
  blog_posts as blog_posts_table,
  brand_guidelines as brand_guidelines_table,
  content_segments as content_segments_table,
  generation_queue as generation_queue_table,
  settings as settings_table,
  videos as videos_table,
} from "@/db/schema";
import { generateScript, isClaudeConfigured, parseBrandGuideline } from "@/lib/claude";
import {
  createAIShorts,
  createLinkFromUrl,
  createLinkToVideo,
  createLipsyncV2,
  getRemainingCredits,
  isCreatifyConfigured,
  mapAspectRatio,
  mapToCreatifyStyle,
  mapToVisualStyle,
  type CreatifyStyle,
} from "@/lib/creatify";
import { isLocalEngineConfigured, toAspectRatio, toOpenAIVoice } from "@/lib/local-engine";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";
import type {
  GenerationQueueItem,
  BlogPost,
  ContentSegment,
  VideoDefaults,
  VideoInsert,
  BrandGuideline,
  BrandGuidelineTyped,
} from "@/lib/supabase/types";

const SETTINGS_KEY = "video_defaults";
const MAX_CONCURRENT = 10; // Process up to 10 items at a time

// Default values when no settings exist
const DEFAULT_VIDEO_SETTINGS: VideoDefaults = {
  apiMethod: "ai_shorts",
  creatifyStyle: "4K realistic",
  visualStyle: "FullScreenTemplate",
  videoLength: 30,
  avatarId: null,
  aspectRatio: "9:16",
  voiceId: null,
  voiceoverVolume: 80,
  backgroundMusicVolume: 30,
  targetDuration: 60,
  scriptStyle: "engaging",
  scriptTone: "professional",
};

function getDefaultVideoSettings(): VideoDefaults {
  if (!isCreatifyConfigured() && isLocalEngineConfigured()) {
    return {
      ...DEFAULT_VIDEO_SETTINGS,
      apiMethod: "local",
      visualStyle: undefined,
    };
  }

  return DEFAULT_VIDEO_SETTINGS;
}

/**
 * Cron endpoint to process the generation queue.
 * Protected by CRON_SECRET header verification.
 *
 * This runs every 5 minutes and:
 * 1. Gets next pending items (limit 3 concurrent)
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

    // Fetch video defaults
    let settingsData: { value: unknown } | undefined;
    try {
      const [settingsRow] = await db
        .select({ value: settings_table.value })
        .from(settings_table)
        .where(eq(settings_table.key, SETTINGS_KEY))
        .limit(1);
      settingsData = settingsRow;
    } catch {
      settingsData = undefined;
    }

    const defaults: VideoDefaults =
      (settingsData?.value as VideoDefaults) ?? getDefaultVideoSettings();
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

    // Fetch default brand guideline if one exists
    let brandGuideline: BrandGuidelineTyped | null = null;
    let brandData: BrandGuideline | undefined;
    try {
      const [brandRow] = await db
        .select()
        .from(brand_guidelines_table)
        .where(eq(brand_guidelines_table.is_default, true))
        .limit(1);
      brandData = brandRow as BrandGuideline | undefined;
    } catch {
      brandData = undefined;
    }

    if (brandData) {
      brandGuideline = parseBrandGuideline(brandData);
    }

    // Get next pending queue items
    let queueItems: GenerationQueueItem[];
    try {
      queueItems = await db
        .select()
        .from(generation_queue_table)
        .where(
          and(
            eq(generation_queue_table.status, "pending"),
            lte(generation_queue_table.scheduled_for, new Date().toISOString())
          )
        )
        .orderBy(
          asc(generation_queue_table.priority),
          asc(generation_queue_table.scheduled_for)
        )
        .limit(MAX_CONCURRENT);
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

/**
 * Process a single queue item: generate script, create video, call the configured renderer.
 */
async function processQueueItem(
  database: DbClient,
  item: GenerationQueueItem,
  defaults: VideoDefaults,
  brandGuideline: BrandGuidelineTyped | null
): Promise<{ videoId: string }> {
  // Mark as processing
  try {
    await database
      .update(generation_queue_table)
      .set({
        status: "processing",
        started_at: new Date().toISOString(),
        attempts: item.attempts + 1,
      })
      .where(eq(generation_queue_table.id, item.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  try {
    // Fetch blog post
    let blogPost: BlogPost | undefined;
    try {
      const [blogPostRow] = await database
        .select()
        .from(blog_posts_table)
        .where(eq(blog_posts_table.id, item.blog_post_id))
        .limit(1);
      blogPost = blogPostRow;
    } catch {
      blogPost = undefined;
    }

    if (!blogPost) {
      throw new Error(`Blog post not found: ${item.blog_post_id}`);
    }

    // Fetch segment if applicable
    let segment: ContentSegment | null = null;
    if (item.segment_id) {
      let segmentData: ContentSegment | undefined;
      try {
        const [segmentRow] = await database
          .select()
          .from(content_segments_table)
          .where(eq(content_segments_table.id, item.segment_id))
          .limit(1);
        segmentData = segmentRow;
      } catch {
        segmentData = undefined;
      }

      if (!segmentData) {
        throw new Error(`Segment not found: ${item.segment_id}`);
      }
      segment = segmentData;
    }

    // Determine content source - use segment content if available
    const contentTitle = segment?.title || blogPost.title;
    const contentBody = segment?.content || blogPost.content;

    // Reuse existing script if already generated (avoids redundant Claude API calls on retry)
    const existingScript = segment?.generated_script || blogPost.generated_script;

    let script: string;
    if (existingScript) {
      console.log(
        `[process-queue] Reusing existing script for ${item.segment_id ? "segment" : "post"} ${item.segment_id || item.blog_post_id}`
      );
      script = existingScript;
    } else {
      const scriptResult = await generateScript({
        title: contentTitle,
        content: contentBody,
        targetDuration: defaults.targetDuration,
        style:
          defaults.scriptStyle === "engaging"
            ? "entertaining"
            : defaults.scriptStyle === "educational"
            ? "informative"
            : "informative",
        tone:
          defaults.scriptTone === "professional"
            ? "formal"
            : defaults.scriptTone === "conversational"
            ? "casual"
            : "casual",
        brandGuideline,
      });

      script = scriptResult.script;

      // Save generated script to segment or blog post
      if (segment) {
        try {
          await database
            .update(content_segments_table)
            .set({ generated_script: script })
            .where(eq(content_segments_table.id, segment.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
      } else {
        try {
          await database
            .update(blog_posts_table)
            .set({ generated_script: script })
            .where(eq(blog_posts_table.id, item.blog_post_id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
      }
    }

    // Determine API method (backfill for legacy settings)
    const apiMethod = defaults.apiMethod || "ai_shorts";

    if (apiMethod !== "local") {
      // Check credits before creating any records
      const credits = await getRemainingCredits();
      if (credits.remaining_credits < 5) {
        throw new Error(
          `Insufficient Creatify credits (${credits.remaining_credits} remaining). Need at least 5.`
        );
      }
    }

    // Check for existing active video (prevents duplicate records on retry)
    let existingVideos:
      | Array<Pick<typeof videos_table.$inferSelect, "id" | "status" | "creatify_job_id">>
      | undefined;
    try {
      existingVideos = await database
        .select({
          id: videos_table.id,
          status: videos_table.status,
          creatify_job_id: videos_table.creatify_job_id,
        })
        .from(videos_table)
        .where(
          and(
            eq(videos_table.blog_post_id, item.blog_post_id),
            inArray(videos_table.status, ["pending", "generating", "completed"]),
            item.segment_id
              ? eq(videos_table.content_segment_id, item.segment_id)
              : isNull(videos_table.content_segment_id)
          )
        );
    } catch {
      existingVideos = undefined;
    }

    if (existingVideos && existingVideos.length > 0) {
      const existing = existingVideos[0];
      console.log(
        `[process-queue] Skipping duplicate: video ${existing.id} already exists for post ${item.blog_post_id}` +
        (item.segment_id ? ` segment ${item.segment_id}` : "") +
        ` (status: ${existing.status})`
      );

      // Mark queue item as completed since video already exists
      try {
        await database
          .update(generation_queue_table)
          .set({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .where(eq(generation_queue_table.id, item.id));
      } catch {
        // Preserve prior behavior: update failures were ignored
      }

      return { videoId: existing.id };
    }

    // Map aspect ratio format (our format to Creatify format)
    const creatifyAspectRatio = mapAspectRatio(defaults.aspectRatio);

    // Map app style to Creatify style (ai_shorts API)
    const creatifyStyle: CreatifyStyle = mapToCreatifyStyle(defaults.creatifyStyle);

    // Create video record in database
    const videoInsert: VideoInsert = {
      blog_post_id: item.blog_post_id,
      content_segment_id: item.segment_id || null,
      script,
      style: "stock_footage", // Our DB enum
      style_options: {
        ...(apiMethod === "local"
          ? {
              apiVersion: "local",
              aspectRatio: toAspectRatio(defaults.aspectRatio),
              voice: toOpenAIVoice(defaults.voiceId),
              visualStyle:
                defaults.visualStyle && defaults.visualStyle !== "FullScreenTemplate"
                  ? defaults.visualStyle
                  : undefined,
            }
          : {
              apiVersion: apiMethod,
              creatifyStyle,
              aspectRatio: creatifyAspectRatio,
              voiceId: defaults.voiceId,
              voiceoverVolume: defaults.voiceoverVolume / 100,
              backgroundMusicVolume: defaults.backgroundMusicVolume / 100,
              visualStyle: defaults.visualStyle,
              videoLength: defaults.videoLength,
              avatarId: defaults.avatarId,
            }),
      },
      status: "pending",
      auto_generated: true,
      generation_attempt: 1,
      approval_status: "pending_review",
    };

    let video: typeof videos_table.$inferSelect | undefined;
    try {
      const [videoRow] = await database
        .insert(videos_table)
        .values(videoInsert)
        .returning();
      video = videoRow;
    } catch (insertError) {
      throw new Error(
        `Failed to create video record: ${insertError instanceof Error ? insertError.message : "Unknown error"}`
      );
    }

    if (!video) {
      throw new Error("Failed to create video record: Unknown error");
    }

    if (apiMethod === "local") {
      try {
        await database
          .update(generation_queue_table)
          .set({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .where(eq(generation_queue_table.id, item.id));
      } catch {
        // Preserve prior behavior: update failures were ignored
      }

      console.log(
        `[process-queue] Successfully queued local video for item ${item.id}, video ${video.id}`
      );

      return { videoId: video.id };
    }

    // Call appropriate Creatify API based on method
    let creatifyJob;

    switch (apiMethod) {
      case "link_to_video": {
        console.log(`[process-queue] Using Link-to-Video for post: ${blogPost.url}`);

        // Step 1: Create link from blog post URL
        const link = await createLinkFromUrl(blogPost.url);

        // Step 2: Create video from the link
        creatifyJob = await createLinkToVideo({
          link: link.id,
          override_script: script,
          visual_style: defaults.visualStyle || mapToVisualStyle(defaults.creatifyStyle),
          video_length: defaults.videoLength || 30,
          aspect_ratio: creatifyAspectRatio,
          override_voice: defaults.voiceId || undefined,
        });
        break;
      }

      case "lipsync_v2": {
        console.log(`[process-queue] Using Lipsync V2 with avatar: ${defaults.avatarId}`);

        if (!defaults.avatarId) {
          throw new Error("Avatar ID is required for lipsync_v2 method. Set it in video defaults.");
        }
        if (!defaults.voiceId) {
          throw new Error("Voice ID is required for lipsync_v2 method. Set it in video defaults.");
        }

        creatifyJob = await createLipsyncV2({
          video_inputs: [
            {
              character: {
                type: "avatar",
                avatar_id: defaults.avatarId,
              },
              voice: {
                type: "text",
                voice_id: defaults.voiceId,
                input_text: script,
              },
            },
          ],
          aspect_ratio: creatifyAspectRatio,
        });
        break;
      }

      default: {
        // ai_shorts (legacy default)
        creatifyJob = await createAIShorts({
          script,
          aspect_ratio: creatifyAspectRatio,
          style: creatifyStyle,
          accent: defaults.voiceId || undefined,
          voiceover_volume: defaults.voiceoverVolume / 100,
          background_music_volume: defaults.backgroundMusicVolume / 100,
        });
        break;
      }
    }

    // Update video with Creatify job ID
    try {
      await database
        .update(videos_table)
        .set({
          creatify_job_id: creatifyJob.id,
          status: "generating",
        })
        .where(eq(videos_table.id, video.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }

    // Mark queue item as completed
    try {
      await database
        .update(generation_queue_table)
        .set({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .where(eq(generation_queue_table.id, item.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }

    console.log(
      `[process-queue] Successfully processed item ${item.id}, video ${video.id}, creatify job ${creatifyJob.id}`
    );

    return { videoId: video.id };
  } catch (error) {
    // Check if max attempts reached
    const newAttempts = item.attempts + 1;
    const maxAttemptsReached = newAttempts >= item.max_attempts;

    // Update queue item with error
    try {
      await database
        .update(generation_queue_table)
        .set({
          status: maxAttemptsReached ? "failed" : "pending",
          error_message: error instanceof Error ? error.message : "Unknown error",
          // Reset scheduled_for for retry (with exponential backoff)
          scheduled_for: maxAttemptsReached
            ? item.scheduled_for
            : new Date(
                Date.now() + Math.pow(2, newAttempts) * 60 * 1000
              ).toISOString(), // 2^attempts minutes
        })
        .where(eq(generation_queue_table.id, item.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }

    throw error;
  }
}
