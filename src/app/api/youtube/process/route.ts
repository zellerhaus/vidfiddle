import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { youtube_sources } from "@/db/schema";
import { extractYouTubeVideoId } from "@/lib/youtube";
import { isSubmagicConfigured, createMagicClips } from "@/lib/submagic";
import type { CaptionStylePreset, YouTubeClipPreferences } from "@/lib/supabase/types";

/**
 * POST /api/youtube/process
 * Start processing a YouTube URL into clips.
 * Creates a youtube_sources record and returns immediately.
 * The check-youtube cron job will advance the pipeline.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, captionStyle, clipPreferences } = body as {
      url: string;
      captionStyle?: CaptionStylePreset;
      clipPreferences?: YouTubeClipPreferences;
    };

    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 }
      );
    }

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      );
    }

    // Check for duplicate
    const [existing, duplicate] = await db
      .select({ id: youtube_sources.id, status: youtube_sources.status })
      .from(youtube_sources)
      .where(eq(youtube_sources.youtube_video_id, videoId))
      .limit(2)
      .catch(() => []);

    if (existing && !duplicate) {
      return NextResponse.json(
        {
          error: "This YouTube video has already been submitted",
          existingId: existing.id,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    // Determine pipeline: Submagic (preferred) or legacy Railway pipeline
    const useSubmagic = isSubmagicConfigured();

    if (useSubmagic) {
      // Submit to Submagic Magic Clips API
      const prefs = clipPreferences || { targetDuration: 45, maxClips: 5 };
      // Build webhook URL from the request origin
      const origin = request.headers.get("origin") || request.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";
      const webhookUrl = origin ? `${origin}/api/webhooks/submagic` : undefined;

      const submagicProject = await createMagicClips({
        title: `yt-${videoId}`,
        language: "en",
        youtubeUrl: url.trim(),
        minClipLength: 15,
        maxClipLength: prefs.targetDuration + 15,
        faceTracking: true,
        ...(webhookUrl ? { webhookUrl } : {}),
      });

      // Create youtube_sources record linked to Submagic project
      let source;
      try {
        [source] = await db
          .insert(youtube_sources)
          .values({
            youtube_url: url.trim(),
            youtube_video_id: videoId,
            status: "submagic_processing",
            submagic_project_id: submagicProject.id,
            caption_style: captionStyle || null,
            clip_preferences: clipPreferences || { targetDuration: 45, maxClips: 5 },
          })
          .returning();

        if (!source) {
          throw new Error("Failed to create processing job");
        }
      } catch (insertError) {
        console.error("Error creating youtube source:", insertError);
        return NextResponse.json(
          { error: "Failed to create processing job" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        id: source.id,
        videoId,
        status: "submagic_processing",
        pipeline: "submagic",
        submagicProjectId: submagicProject.id,
      });
    }

    // Legacy pipeline: Railway worker + Deepgram + Creatomate
    let source;
    try {
      [source] = await db
        .insert(youtube_sources)
        .values({
          youtube_url: url.trim(),
          youtube_video_id: videoId,
          status: "pending",
          caption_style: captionStyle || null,
          clip_preferences: clipPreferences || { targetDuration: 45, maxClips: 5 },
        })
        .returning();

      if (!source) {
        throw new Error("Failed to create processing job");
      }
    } catch (insertError) {
      console.error("Error creating youtube source:", insertError);
      return NextResponse.json(
        { error: "Failed to create processing job" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: source.id,
      videoId,
      status: "pending",
      pipeline: "legacy",
    });
  } catch (error) {
    console.error("Error processing YouTube URL:", error);
    return NextResponse.json(
      { error: "Failed to process YouTube URL" },
      { status: 500 }
    );
  }
}
