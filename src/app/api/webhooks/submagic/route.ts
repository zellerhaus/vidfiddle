import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blog_posts, videos, youtube_clips, youtube_sources } from "@/db/schema";
import { generateMultipleCaptions, isClaudeConfigured } from "@/lib/claude";
import type { Platform } from "@/lib/supabase/types";
import { verifySubmagicWebhookToken, type SubmagicClip } from "@/lib/submagic";

const DEFAULT_PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "facebook",
];

/**
 * Submagic webhook — called when a Magic Clips project completes.
 * Downloads clips, stores them, and creates approval queue entries.
 * Requires the token that /api/youtube/process put in the webhook URL.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, status, title, duration, magicClips } = body;

    console.log(
      `[submagic-webhook] Received webhook for project ${projectId}: ${status}`
    );

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    // Find the source by submagic_project_id
    let source;
    try {
      [source] = await db
        .select()
        .from(youtube_sources)
        .where(eq(youtube_sources.submagic_project_id, projectId))
        .limit(1);
    } catch {
      source = null;
    }

    if (!source) {
      console.error(
        `[submagic-webhook] No source found for project ${projectId}`
      );
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }

    const token = request.nextUrl.searchParams.get("token");
    if (!verifySubmagicWebhookToken(source.youtube_video_id, token)) {
      console.error(
        `[submagic-webhook] Rejected project ${projectId}: missing or invalid token`
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Already processed (idempotency)
    if (source.status === "completed") {
      return NextResponse.json({ success: true, message: "Already completed" });
    }

    if (status === "failed") {
      try {
        await db
          .update(youtube_sources)
          .set({
            status: "failed",
            error_message: "Submagic processing failed",
          })
          .where(eq(youtube_sources.id, source.id));
      } catch {
        // Ignore update errors to match previous behavior
      }
      return NextResponse.json({ success: true, status: "failed" });
    }

    if (status !== "completed") {
      return NextResponse.json({ success: true, message: "Not yet complete" });
    }

    // Process completed clips
    const clips: SubmagicClip[] = magicClips || [];
    console.log(
      `[submagic-webhook] Finalizing ${clips.length} clips for source ${source.id}`
    );

    let finalized = 0;

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (clip.status !== "completed" || !clip.downloadUrl) continue;

      try {
        // Use Submagic's CDN URL directly (download URLs are CloudFront-hosted)
        const videoUrl = clip.directUrl || clip.downloadUrl;

        // Create youtube_clips record
        let clipRecord;
        try {
          const [insertedClip] = await db
            .insert(youtube_clips)
            .values({
              youtube_source_id: source.id,
              clip_index: i,
              title: clip.title,
              start_time: 0,
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
          clipRecord = insertedClip
            ? {
                ...insertedClip,
                youtube_sources: source,
              }
            : null;
        } catch (clipError) {
          console.error(
            `[submagic-webhook] Failed to create clip record: ${
              clipError instanceof Error ? clipError.message : String(clipError)
            }`
          );
          continue;
        }

        if (!clipRecord) {
          console.error(
            "[submagic-webhook] Failed to create clip record: no data returned"
          );
          continue;
        }

        // Create blog_post + video records for the approval queue
        let blogPost;
        try {
          [blogPost] = await db
            .insert(blog_posts)
            .values({
              url: source.youtube_url,
              title: clip.title,
              content: clip.title,
              excerpt: clip.title,
              source_type: "youtube",
              status: "converted",
            })
            .returning({ id: blog_posts.id });
        } catch {
          blogPost = null;
        }

        if (!blogPost) continue;

        let video;
        try {
          [video] = await db
            .insert(videos)
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
              duration_seconds: Math.round(clip.duration),
              approval_status: "pending_review",
              auto_generated: true,
              generation_attempt: 1,
            })
            .returning({ id: videos.id });
        } catch {
          video = null;
        }

        if (!video) continue;

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
            await db
              .update(videos)
              .set({ generated_captions: captions })
              .where(eq(videos.id, video.id));
          } catch (captionError) {
            console.error(
              `[submagic-webhook] Caption generation failed for clip ${i}:`,
              captionError
            );
          }
        }

        // Link clip to blog_post and video
        try {
          await db
            .update(youtube_clips)
            .set({ blog_post_id: blogPost.id, video_id: video.id })
            .where(eq(youtube_clips.id, clipRecord.id));
        } catch {
          // Ignore update errors to match previous behavior
        }

        finalized++;
        console.log(
          `[submagic-webhook] Clip ${i} finalized: "${clip.title}" (viral: ${clip.viralityScores?.total})`
        );
      } catch (clipErr) {
        console.error(
          `[submagic-webhook] Error finalizing clip ${i}:`,
          clipErr
        );
      }
    }

    // Mark source as completed
    try {
      await db
        .update(youtube_sources)
        .set({
          status: "completed",
          duration_seconds: duration || null,
          title: title || source.title,
        })
        .where(eq(youtube_sources.id, source.id));
    } catch {
      // Ignore update errors to match previous behavior
    }

    console.log(
      `[submagic-webhook] Source ${source.id} completed: ${finalized}/${clips.length} clips finalized`
    );

    return NextResponse.json({
      success: true,
      finalized,
      total: clips.length,
    });
  } catch (error) {
    console.error("[submagic-webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
