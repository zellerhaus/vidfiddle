import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, type DbClient } from "@/db";
import {
  blog_posts as blog_posts_table,
  videos as videos_table,
  youtube_clips as youtube_clips_table,
  youtube_sources as youtube_sources_table,
} from "@/db/schema";
import { downloadYouTubeVideo, cutClip } from "@/lib/worker-client";
import { transcribeAudio, isDeepgramConfigured } from "@/lib/deepgram";
import { detectViralMoments } from "@/lib/viral-detector";
import {
  renderCaptionedClip,
  getRenderStatus,
  isRenderComplete,
  isCreatomateConfigured,
  DEFAULT_CAPTION_PRESETS,
} from "@/lib/creatomate";
import { generateMultipleCaptions, isClaudeConfigured } from "@/lib/claude";
import { transferVideoToStorage } from "@/lib/storage";
import { getProject } from "@/lib/submagic";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";
import type {
  YouTubeSource,
  YouTubeClip,
  WordTimestamp,
  CaptionStylePreset,
  YouTubeClipPreferences,
  Platform,
} from "@/lib/supabase/types";

const DEFAULT_PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "facebook",
];

const RENDER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

type YouTubeClipWithSource = YouTubeClip & { youtube_sources: YouTubeSource };

/**
 * Cron endpoint to advance YouTube processing pipeline.
 * Runs every 2 minutes.
 *
 * Pipeline stages:
 * pending → downloading → transcribing → analyzing → processing → completed
 *
 * Download and clip cutting are async — the worker (src/worker) processes in the
 * background and updates the DB directly. This cron detects completed work
 * and advances to the next stage.
 */
export async function GET(request: NextRequest) {
  const logContext = await startCronLog("check-youtube");

  try {
    // Verify CRON_SECRET
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) {
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

    // Fetch all non-terminal youtube_sources
    let sources: YouTubeSource[];
    try {
      sources = await db
        .select()
        .from(youtube_sources_table)
        .where(
          and(
            ne(youtube_sources_table.status, "completed"),
            ne(youtube_sources_table.status, "failed")
          )
        )
        .orderBy(asc(youtube_sources_table.created_at))
        .limit(3);
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Unknown database error";
      addError(logContext, `Failed to fetch sources: ${errorMessage}`);
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Failed to fetch sources" },
        { status: 500 }
      );
    }

    if (!sources || sources.length === 0) {
      // Also check for clips that need processing
      await processClips(db, logContext);
      await completeCronLog(logContext);
      return NextResponse.json({
        success: true,
        message: "No sources to process",
      });
    }

    const results: Array<{
      sourceId: string;
      previousStatus: string;
      newStatus: string;
      error?: string;
    }> = [];

    // Process each source one step at a time
    for (const source of sources) {
      try {
        const newStatus = await advanceSource(db, source);
        results.push({
          sourceId: source.id,
          previousStatus: source.status,
          newStatus,
        });
        incrementProcessed(logContext);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error processing source ${source.id}:`, msg);

        // Mark source as failed
        try {
          await db
            .update(youtube_sources_table)
            .set({ status: "failed", error_message: msg })
            .where(eq(youtube_sources_table.id, source.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }

        results.push({
          sourceId: source.id,
          previousStatus: source.status,
          newStatus: "failed",
          error: msg,
        });
        addError(logContext, `Source ${source.id}: ${msg}`);
      }
    }

    // Also process clips (cutting, caption rendering)
    await processClips(db, logContext);

    setSummary(logContext, "sources", results);
    await completeCronLog(logContext);

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Error in check-youtube cron:", error);
    addError(
      logContext,
      error instanceof Error ? error.message : "Unknown error"
    );
    await completeCronLog(logContext, "error");
    return NextResponse.json(
      { error: "Failed to process YouTube sources" },
      { status: 500 }
    );
  }
}

/**
 * Advance a youtube_source one step in the pipeline
 */
async function advanceSource(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  switch (source.status) {
    case "submagic_processing":
      return await handleSubmagicProcessing(database, source);
    case "pending":
      return await handlePending(database, source);
    case "downloading":
      return await handleDownloading(database, source);
    case "transcribing":
      return await handleTranscribing(database, source);
    case "analyzing":
      return await handleAnalyzing(database, source);
    case "processing":
      return await handleProcessing(database, source);
    default:
      return source.status;
  }
}

/**
 * Submagic path: poll the Magic Clips project and finalize clips when complete.
 * Replaces the entire legacy pipeline (download → transcribe → analyze → cut → render).
 */
async function handleSubmagicProcessing(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  const projectId = source.submagic_project_id;
  if (!projectId) {
    throw new Error("submagic_project_id is missing on source");
  }

  console.log(
    `[check-youtube] Polling Submagic project ${projectId} for source ${source.id}`
  );

  const project = await getProject(projectId);

  if (project.status === "failed") {
    try {
      await database
        .update(youtube_sources_table)
        .set({ status: "failed", error_message: "Submagic processing failed" })
        .where(eq(youtube_sources_table.id, source.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }
    return "failed";
  }

  if (project.status !== "completed") {
    console.log(
      `[check-youtube] Submagic project ${projectId} still ${project.status}`
    );
    return "submagic_processing";
  }

  // Project completed — finalize all clips
  const clips = project.magicClips || [];
  console.log(
    `[check-youtube] Submagic project completed with ${clips.length} clips`
  );

  if (clips.length === 0) {
    try {
      await database
        .update(youtube_sources_table)
        .set({
          status: "completed",
          duration_seconds: project.duration || null,
          title: project.title,
        })
        .where(eq(youtube_sources_table.id, source.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }
    return "completed";
  }

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.status !== "completed" || !clip.downloadUrl) continue;

    try {
      // Use Submagic's CDN URL directly (CloudFront-hosted)
      const videoUrl = clip.directUrl || clip.downloadUrl;

      // Create youtube_clips record
      let clipRecord: YouTubeClip | undefined;
      try {
        const [clipRow] = await database
          .insert(youtube_clips_table)
          .values({
            youtube_source_id: source.id,
            clip_index: i,
            title: clip.title,
            start_time: 0, // Submagic doesn't expose timestamps
            end_time: clip.duration,
            duration_seconds: clip.duration,
            viral_score: clip.viralityScores?.total
              ? clip.viralityScores.total / 100
              : null,
            hook_reason: clip.viralityScores
              ? `Shareability: ${clip.viralityScores.shareability}, Hook: ${clip.viralityScores.hook_strength}, Story: ${clip.viralityScores.story_quality}, Emotion: ${clip.viralityScores.emotional_impact}`
              : null,
            captioned_clip_url: videoUrl,
            raw_clip_url: videoUrl,
            status: "completed",
          })
          .returning();
        clipRecord = clipRow;
      } catch (clipError) {
        console.error(
          `[check-youtube] Failed to create clip record: ${clipError instanceof Error ? clipError.message : "Unknown error"}`
        );
        continue;
      }

      if (!clipRecord) {
        console.error(
          `[check-youtube] Failed to create clip record: Unknown error`
        );
        continue;
      }

      // Finalize into the approval queue (blog_post + video records)
      await finalizeSubmagicClip(
        database,
        { ...clipRecord, youtube_sources: source },
        videoUrl
      );

      console.log(
        `[check-youtube] Submagic clip ${i} finalized: "${clip.title}" (viral: ${clip.viralityScores?.total})`
      );
    } catch (clipErr) {
      console.error(
        `[check-youtube] Error finalizing Submagic clip ${i}:`,
        clipErr
      );
    }
  }

  try {
    await database
      .update(youtube_sources_table)
      .set({
        status: "completed",
        duration_seconds: project.duration || null,
        title: project.title,
      })
      .where(eq(youtube_sources_table.id, source.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  return "completed";
}

/**
 * Finalize a Submagic clip: create blog_post + video records for the approval queue.
 * Similar to finalizeClip but doesn't need transcript_words (Submagic bakes captions in).
 */
async function finalizeSubmagicClip(
  database: DbClient,
  clip: YouTubeClipWithSource,
  videoUrl: string
): Promise<void> {
  const source = clip.youtube_sources;

  // Create a blog_posts adapter row
  let blogPost: { id: string } | undefined;
  try {
    const [blogPostRow] = await database
      .insert(blog_posts_table)
      .values({
        url: source.youtube_url,
        title: clip.title,
        content: clip.title, // Submagic doesn't expose transcript text
        excerpt: clip.title,
        source_type: "youtube",
        status: "converted",
      })
      .returning({ id: blog_posts_table.id });
    blogPost = blogPostRow;
  } catch (blogPostError) {
    throw new Error(
      `Failed to create blog post: ${blogPostError instanceof Error ? blogPostError.message : "Unknown error"}`
    );
  }

  if (!blogPost) {
    throw new Error("Failed to create blog post: Unknown error");
  }

  // Create video record for the approval queue
  let video: { id: string } | undefined;
  try {
    const [videoRow] = await database
      .insert(videos_table)
      .values({
        blog_post_id: blogPost.id,
        script: clip.title,
        style: "stock_footage" as const,
        style_options: {
          sourceType: "youtube_clip",
          youtubeSourceId: source.id,
          pipeline: "submagic",
        },
        status: "completed",
        video_url: videoUrl,
        duration_seconds: Math.round(clip.duration_seconds),
        approval_status: "pending_review",
        auto_generated: true,
        generation_attempt: 1,
      })
      .returning({ id: videos_table.id });
    video = videoRow;
  } catch (videoError) {
    throw new Error(
      `Failed to create video: ${videoError instanceof Error ? videoError.message : "Unknown error"}`
    );
  }

  if (!video) {
    throw new Error("Failed to create video: Unknown error");
  }

  // Generate social media captions
  if (isClaudeConfigured() && clip.title) {
    try {
      const captionResults = await generateMultipleCaptions(
        clip.title,
        DEFAULT_PLATFORMS
      );
      const captions: Record<string, string> = {};
      for (const [platform, result] of Object.entries(captionResults)) {
        captions[platform] = result.caption;
      }
      await database
        .update(videos_table)
        .set({ generated_captions: captions })
        .where(eq(videos_table.id, video.id));
    } catch (captionError) {
      console.error(
        `[check-youtube] Failed to generate captions for Submagic clip ${clip.id}:`,
        captionError
      );
    }
  }

  // Link the clip to its blog_post and video
  try {
    await database
      .update(youtube_clips_table)
      .set({
        blog_post_id: blogPost.id,
        video_id: video.id,
      })
      .where(eq(youtube_clips_table.id, clip.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }
}

/**
 * Step 1: Fire async download to the worker
 * The worker processes in the background and updates the DB when done.
 */
async function handlePending(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  console.log(`[check-youtube] Starting download for source ${source.id}`);

  try {
    await database
      .update(youtube_sources_table)
      .set({ status: "downloading" })
      .where(eq(youtube_sources_table.id, source.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  // Fire-and-forget: worker processes in background and updates DB directly
  await downloadYouTubeVideo(source.youtube_url, source.id);

  return "downloading";
}

/**
 * Step 1b: Check if the async download has completed.
 * The worker sets source_video_url when done, or status='failed' on error.
 * If download is complete, immediately start transcription.
 */
async function handleDownloading(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  // Re-fetch source to get fresh data (worker may have updated it)
  let freshSource: YouTubeSource | undefined;
  try {
    const [freshSourceRow] = await database
      .select()
      .from(youtube_sources_table)
      .where(eq(youtube_sources_table.id, source.id))
      .limit(1);
    freshSource = freshSourceRow;
  } catch {
    freshSource = undefined;
  }

  if (!freshSource) return "downloading";

  // Worker sets status='failed' on error
  if (freshSource.status === "failed") return "failed";

  // Check if worker has completed (source_video_url populated)
  if (!freshSource.source_video_url) {
    console.log(`[check-youtube] Source ${source.id} still downloading...`);
    return "downloading";
  }

  // Download complete — start transcription
  console.log(
    `[check-youtube] Download complete for ${source.id}, starting transcription`
  );

  if (isDeepgramConfigured()) {
    const audioUrl = freshSource.source_video_url.replace(
      "source.mp4",
      "audio.mp3"
    );
    const transcript = await transcribeAudio(audioUrl);

    try {
      await database
        .update(youtube_sources_table)
        .set({
          status: "analyzing",
          transcript: {
            words: transcript.words,
            fullTranscript: transcript.fullTranscript,
            durationSeconds: transcript.durationSeconds,
          },
        })
        .where(eq(youtube_sources_table.id, source.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }

    return "analyzing";
  }

  try {
    await database
      .update(youtube_sources_table)
      .set({ status: "transcribing" })
      .where(eq(youtube_sources_table.id, source.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  return "transcribing";
}

/**
 * Step 2: Transcribe audio (if not done inline with download detection)
 */
async function handleTranscribing(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  if (!isDeepgramConfigured()) {
    throw new Error("Deepgram API not configured");
  }

  // Get the audio URL from storage
  const audioUrl = source.source_video_url?.replace("source.mp4", "audio.mp3");
  if (!audioUrl) {
    throw new Error("No audio URL available for transcription");
  }

  console.log(`[check-youtube] Transcribing source ${source.id}`);

  const transcript = await transcribeAudio(audioUrl);

  try {
    await database
      .update(youtube_sources_table)
      .set({
        status: "analyzing",
        transcript: {
          words: transcript.words,
          fullTranscript: transcript.fullTranscript,
          durationSeconds: transcript.durationSeconds,
        },
      })
      .where(eq(youtube_sources_table.id, source.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  return "analyzing";
}

/**
 * Step 3: Use Claude to detect viral moments
 */
async function handleAnalyzing(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  if (!isClaudeConfigured()) {
    throw new Error("Claude API not configured");
  }

  const transcript = source.transcript as unknown as {
    words: WordTimestamp[];
    fullTranscript: string;
  } | null;

  if (!transcript?.words) {
    throw new Error("No transcript available for analysis");
  }

  const preferences = (source.clip_preferences || {
    targetDuration: 45,
    maxClips: 5,
  }) as unknown as YouTubeClipPreferences;

  console.log(`[check-youtube] Analyzing source ${source.id} for viral moments`);

  const moments = await detectViralMoments({
    title: source.title || "Untitled",
    transcript: transcript.words,
    targetClipDuration: preferences.targetDuration,
    maxClips: preferences.maxClips,
  });

  // Create youtube_clips records
  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i];
    try {
      await database.insert(youtube_clips_table).values({
        youtube_source_id: source.id,
        clip_index: i,
        title: moment.title,
        start_time: moment.startTime,
        end_time: moment.endTime,
        duration_seconds: moment.endTime - moment.startTime,
        viral_score: moment.viralScore,
        hook_reason: moment.hookReason,
        transcript_words: moment.words,
        status: "pending",
      });
    } catch {
      // Preserve prior behavior: insert failures were ignored
    }
  }

  try {
    await database
      .update(youtube_sources_table)
      .set({ status: "processing" })
      .where(eq(youtube_sources_table.id, source.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  return "processing";
}

/**
 * Step 4: Check if all clips are complete
 */
async function handleProcessing(
  database: DbClient,
  source: YouTubeSource
): Promise<string> {
  let clips: YouTubeClip[] | undefined;
  try {
    clips = await database
      .select()
      .from(youtube_clips_table)
      .where(eq(youtube_clips_table.youtube_source_id, source.id));
  } catch {
    clips = undefined;
  }

  if (!clips || clips.length === 0) {
    throw new Error("No clips found for source");
  }

  const allComplete = clips.every(
    (c) => c.status === "completed" || c.status === "failed"
  );

  if (allComplete) {
    try {
      await database
        .update(youtube_sources_table)
        .set({ status: "completed" })
        .where(eq(youtube_sources_table.id, source.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }
    return "completed";
  }

  return "processing";
}

/**
 * Process individual clips through three stages:
 * 1. Fire async cut requests for pending clips
 * 2. Detect completed cuts (worker set raw_clip_url) and start caption rendering
 * 3. Check caption rendering status for clips being rendered
 */
async function fetchClipsWithSources(
  database: DbClient,
  whereCondition: ReturnType<typeof and> | ReturnType<typeof eq>,
  limitCount: number
): Promise<YouTubeClipWithSource[] | undefined> {
  try {
    const rows = await database
      .select({
        clip: youtube_clips_table,
        source: youtube_sources_table,
      })
      .from(youtube_clips_table)
      .innerJoin(
        youtube_sources_table,
        eq(youtube_clips_table.youtube_source_id, youtube_sources_table.id)
      )
      .where(whereCondition)
      .limit(limitCount);

    return rows.map((row) => ({ ...row.clip, youtube_sources: row.source }));
  } catch {
    return undefined;
  }
}

async function processClips(
  database: DbClient,
  logContext: Awaited<ReturnType<typeof startCronLog>>
): Promise<void> {
  // 1. Fire async cut requests for pending clips
  const pendingClips = await fetchClipsWithSources(
    database,
    eq(youtube_clips_table.status, "pending"),
    3
  );

  if (pendingClips && pendingClips.length > 0) {
    for (const clip of pendingClips) {
      try {
        await fireClipCut(database, clip);
        incrementProcessed(logContext);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        try {
          await database
            .update(youtube_clips_table)
            .set({ status: "failed", error_message: msg })
            .where(eq(youtube_clips_table.id, clip.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
        addError(logContext, `Clip ${clip.id}: ${msg}`);
      }
    }
  }

  // 2. Check if any cutting clips have completed (worker set raw_clip_url)
  const cutClips = await fetchClipsWithSources(
    database,
    and(
      eq(youtube_clips_table.status, "cutting"),
      isNotNull(youtube_clips_table.raw_clip_url)
    ),
    3
  );

  if (cutClips && cutClips.length > 0) {
    for (const clip of cutClips) {
      try {
        await startCaptionRendering(database, clip);
        incrementProcessed(logContext);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        try {
          await database
            .update(youtube_clips_table)
            .set({ status: "failed", error_message: msg })
            .where(eq(youtube_clips_table.id, clip.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
        addError(logContext, `Clip caption start ${clip.id}: ${msg}`);
      }
    }
  }

  // 3. Check caption rendering status
  const renderingClips = await fetchClipsWithSources(
    database,
    and(
      eq(youtube_clips_table.status, "rendering_captions"),
      isNotNull(youtube_clips_table.creatomate_render_id)
    ),
    5
  );

  if (renderingClips && renderingClips.length > 0) {
    for (const clip of renderingClips) {
      try {
        await checkCaptionRender(database, clip);
        incrementProcessed(logContext);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        try {
          await database
            .update(youtube_clips_table)
            .set({ status: "failed", error_message: msg })
            .where(eq(youtube_clips_table.id, clip.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
        addError(logContext, `Render check ${clip.id}: ${msg}`);
      }
    }
  }
}

/**
 * Fire an async cut request to the worker.
 * The worker will process in the background and set raw_clip_url when done.
 */
async function fireClipCut(
  database: DbClient,
  clip: YouTubeClipWithSource
): Promise<void> {
  const source = clip.youtube_sources;
  if (!source?.source_video_url) {
    throw new Error("Source video URL not available");
  }

  console.log(`[check-youtube] Requesting clip cut ${clip.id}`);

  try {
    await database
      .update(youtube_clips_table)
      .set({ status: "cutting" })
      .where(eq(youtube_clips_table.id, clip.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  // Fire-and-forget: worker processes in background and updates DB directly
  await cutClip({
    videoUrl: source.source_video_url,
    startTime: clip.start_time,
    endTime: clip.end_time,
    clipId: clip.id,
  });
}

/**
 * Start caption rendering for a clip that has been cut.
 * Called when the worker has set raw_clip_url on a cutting clip.
 */
async function startCaptionRendering(
  database: DbClient,
  clip: YouTubeClipWithSource
): Promise<void> {
  if (isCreatomateConfigured()) {
    const source = clip.youtube_sources;
    const captionStyle = (source.caption_style ||
      DEFAULT_CAPTION_PRESETS[0]) as unknown as CaptionStylePreset;

    const { renderId } = await renderCaptionedClip({
      videoUrl: clip.raw_clip_url!,
      style: captionStyle,
    });

    try {
      await database
        .update(youtube_clips_table)
        .set({
          status: "rendering_captions",
          creatomate_render_id: renderId,
        })
        .where(eq(youtube_clips_table.id, clip.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }
  } else {
    // No caption rendering — finalize with raw clip
    await finalizeClip(database, clip, clip.raw_clip_url!);
  }
}

/**
 * Check caption rendering status and finalize if complete.
 *
 * Handles three edge cases:
 * 1. Idempotency: if clip was already finalized (blog_post_id + video_id set),
 *    just mark status='completed' (handles reset scenarios).
 * 2. Timeout: if render exceeds RENDER_TIMEOUT_MS, fall back to raw clip.
 * 3. Atomic update: captioned_clip_url is set inside finalizeClip() so it's
 *    written atomically with the status change.
 */
async function checkCaptionRender(
  database: DbClient,
  clip: YouTubeClipWithSource
): Promise<void> {
  if (!clip.creatomate_render_id) return;

  // Already finalized (e.g. after a status reset) — just mark completed
  if (clip.blog_post_id && clip.video_id) {
    console.log(
      `[check-youtube] Clip ${clip.id} already finalized, marking completed`
    );
    try {
      await database
        .update(youtube_clips_table)
        .set({ status: "completed" })
        .where(eq(youtube_clips_table.id, clip.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }
    return;
  }

  const status = await getRenderStatus(clip.creatomate_render_id);

  if (!isRenderComplete(status.status)) {
    // Check for timeout
    const elapsed = Date.now() - new Date(clip.updated_at).getTime();
    if (elapsed > RENDER_TIMEOUT_MS) {
      console.warn(
        `[check-youtube] Clip ${clip.id} render timed out after ${Math.round(elapsed / 60000)}min`
      );
      if (clip.raw_clip_url) {
        await finalizeClip(database, clip, clip.raw_clip_url);
      } else {
        try {
          await database
            .update(youtube_clips_table)
            .set({
              status: "failed",
              error_message: `Caption render timed out after ${Math.round(elapsed / 60000)} minutes`,
            })
            .where(eq(youtube_clips_table.id, clip.id));
        } catch {
          // Preserve prior behavior: update failures were ignored
        }
      }
      return;
    }

    console.log(
      `[check-youtube] Clip ${clip.id} render still in progress: ${status.status}`
    );
    return;
  }

  if (status.status === "succeeded" && status.url) {
    // Transfer rendered video to storage
    const storageUrl = await transferVideoToStorage(
      status.url,
      `yt-clip-${clip.id}`
    );

    // captioned_clip_url set atomically inside finalizeClip
    await finalizeClip(database, clip, storageUrl, storageUrl);
  } else {
    // Render failed — fall back to raw clip
    console.warn(
      `[check-youtube] Caption render failed for clip ${clip.id}: ${status.error_message}`
    );

    if (clip.raw_clip_url) {
      await finalizeClip(database, clip, clip.raw_clip_url);
    } else {
      try {
        await database
          .update(youtube_clips_table)
          .set({
            status: "failed",
            error_message: `Caption rendering failed: ${status.error_message}`,
          })
          .where(eq(youtube_clips_table.id, clip.id));
      } catch {
        // Preserve prior behavior: update failures were ignored
      }
    }
  }
}

/**
 * Finalize a clip: create blog_post + video records for the approval queue
 */
async function finalizeClip(
  database: DbClient,
  clip: YouTubeClipWithSource,
  finalVideoUrl: string,
  captionedClipUrl?: string
): Promise<void> {
  const source = clip.youtube_sources;

  // Build transcript text for the clip
  const words = (clip.transcript_words || []) as unknown as WordTimestamp[];
  const transcriptText = words.map((w) => w.word).join(" ");

  // Create a blog_posts adapter row
  let blogPost: { id: string } | undefined;
  try {
    const [blogPostRow] = await database
      .insert(blog_posts_table)
      .values({
        url: `${source.youtube_url}&t=${Math.floor(clip.start_time)}`,
        title: clip.title,
        content: transcriptText,
        excerpt: transcriptText.slice(0, 300),
        source_type: "youtube",
        status: "converted",
      })
      .returning({ id: blog_posts_table.id });
    blogPost = blogPostRow;
  } catch (blogPostError) {
    throw new Error(
      `Failed to create blog post: ${blogPostError instanceof Error ? blogPostError.message : "Unknown error"}`
    );
  }

  if (!blogPost) {
    throw new Error("Failed to create blog post: Unknown error");
  }

  // Generate script text (the transcript IS the script for YouTube clips)
  const script = transcriptText;

  // Create video record for the approval queue
  let video: { id: string } | undefined;
  try {
    const [videoRow] = await database
      .insert(videos_table)
      .values({
        blog_post_id: blogPost.id,
        script,
        style: "stock_footage" as const,
        style_options: {
          sourceType: "youtube_clip",
          youtubeSourceId: source.id,
        },
        status: "completed",
        video_url: finalVideoUrl,
        duration_seconds: Math.round(clip.duration_seconds),
        approval_status: "pending_review",
        auto_generated: true,
        generation_attempt: 1,
      })
      .returning({ id: videos_table.id });
    video = videoRow;
  } catch (videoError) {
    throw new Error(
      `Failed to create video: ${videoError instanceof Error ? videoError.message : "Unknown error"}`
    );
  }

  if (!video) {
    throw new Error("Failed to create video: Unknown error");
  }

  // Generate social media captions
  if (isClaudeConfigured() && script) {
    try {
      const captionResults = await generateMultipleCaptions(
        script,
        DEFAULT_PLATFORMS
      );
      const captions: Record<string, string> = {};
      for (const [platform, result] of Object.entries(captionResults)) {
        captions[platform] = result.caption;
      }

      await database
        .update(videos_table)
        .set({ generated_captions: captions })
        .where(eq(videos_table.id, video.id));
    } catch (captionError) {
      console.error(
        `[check-youtube] Failed to generate captions for clip ${clip.id}:`,
        captionError
      );
    }
  }

  // Link the clip to its blog_post and video records
  try {
    await database
      .update(youtube_clips_table)
      .set({
        status: "completed",
        blog_post_id: blogPost.id,
        video_id: video.id,
        ...(captionedClipUrl ? { captioned_clip_url: captionedClipUrl } : {}),
      })
      .where(eq(youtube_clips_table.id, clip.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  console.log(
    `[check-youtube] Clip ${clip.id} finalized: blog_post=${blogPost.id}, video=${video.id}`
  );
}
