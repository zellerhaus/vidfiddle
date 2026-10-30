/**
 * The generation queue: posts (or segments) waiting for a script and a video. Auto Mode adds new
 * feed posts, and the Content page adds the posts you select. The process-queue job works through
 * due items on its schedule; posts added from the Content page are processed right away.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { buildLocalEngineOptions, isLocalEngineConfigured } from "@/lib/local-engine";
import type {
  GenerationQueueItem,
  BlogPost,
  ContentSegment,
  VideoDefaults,
  VideoInsert,
  BrandGuideline,
  BrandGuidelineTyped,
} from "@/lib/supabase/types";

export const SETTINGS_KEY = "video_defaults";

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

export function getDefaultVideoSettings(): VideoDefaults {
  if (!isCreatifyConfigured() && isLocalEngineConfigured()) {
    return {
      ...DEFAULT_VIDEO_SETTINGS,
      apiMethod: "local",
      visualStyle: undefined,
    };
  }

  return DEFAULT_VIDEO_SETTINGS;
}

/** The saved video defaults and the default brand guideline, which every queued video uses. */
export async function loadQueueSettings(
  database: DbClient = db
): Promise<{ defaults: VideoDefaults; brandGuideline: BrandGuidelineTyped | null }> {
  const [settingsRow] = await database
    .select({ value: settings_table.value })
    .from(settings_table)
    .where(eq(settings_table.key, SETTINGS_KEY))
    .limit(1)
    .catch(() => []);
  const [brandRow] = await database
    .select()
    .from(brand_guidelines_table)
    .where(eq(brand_guidelines_table.is_default, true))
    .limit(1)
    .catch(() => []);
  return {
    defaults: (settingsRow?.value as unknown as VideoDefaults | undefined) ?? getDefaultVideoSettings(),
    brandGuideline: brandRow ? parseBrandGuideline(brandRow as BrandGuideline) : null,
  };
}

/** Why queued items can't be processed with these defaults, or null when they can. */
export function queueBlocker(defaults: VideoDefaults): string | null {
  if (!isClaudeConfigured()) {
    return "No script writer is configured. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY with LLM_PROVIDER=anthropic).";
  }
  if ((defaults.apiMethod || "ai_shorts") === "local") {
    return isLocalEngineConfigured() ? null : "Local engine is not configured. Add OPENAI_API_KEY to render videos locally.";
  }
  return isCreatifyConfigured() ? null : "Creatify API is not configured";
}

/**
 * Marks up to `limit` due items as processing and returns them, highest priority first. SKIP LOCKED
 * keeps the scheduled job and a Content page request from taking the same item.
 */
export async function claimQueueItems(
  database: DbClient,
  { limit, ids }: { limit: number; ids?: string[] }
): Promise<GenerationQueueItem[]> {
  if (ids && ids.length === 0) return [];
  const claimed = await database.execute<{ id: string }>(sql`
    update generation_queue set status = 'processing'
    where id in (
      select id from generation_queue
      where status = 'pending' and scheduled_for <= now()
        ${ids ? sql`and ${inArray(generation_queue_table.id, ids)}` : sql``}
      order by priority, scheduled_for
      limit ${limit}
      for update skip locked
    )
    returning id
  `);
  if (claimed.length === 0) return [];
  return database
    .select()
    .from(generation_queue_table)
    .where(inArray(generation_queue_table.id, claimed.map((row) => row.id)))
    .orderBy(asc(generation_queue_table.priority), asc(generation_queue_table.scheduled_for));
}

/**
 * Process a single queue item: generate script, create video, call the configured renderer.
 */
export async function processQueueItem(
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
          ? buildLocalEngineOptions({
              aspectRatio: defaults.aspectRatio,
              voiceProvider: defaults.voiceProvider,
              voice: defaults.voiceId,
              visualStyle: defaults.visualStyle,
              pacing: defaults.pacing,
              music: defaults.musicMood,
              // Settings store volumes as 0–100.
              musicVolume: defaults.backgroundMusicVolume / 100,
            })
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

/**
 * Writes scripts and creates videos for these queue items now, one at a time, instead of waiting
 * for the next process-queue run. Items that fail go back to the queue for that run to retry.
 */
export async function processQueueItemsNow(ids: string[]): Promise<void> {
  const { defaults, brandGuideline } = await loadQueueSettings();
  const items = await claimQueueItems(db, { ids, limit: ids.length });
  for (const item of items) {
    try {
      const { videoId } = await processQueueItem(db, item, defaults, brandGuideline);
      console.log(`[queue] ${item.blog_post_id}: video ${videoId}`);
    } catch (error) {
      console.error(`[queue] ${item.blog_post_id}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
