import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import {
  createAIShorts,
  createLinkFromUrl,
  createLinkToVideo,
  createLipsyncV2,
  getRemainingCredits,
  isCreatifyConfigured,
  type CreatifyStyle,
  type CreatifyAspectRatio,
} from "@/lib/creatify";
import { buildLocalEngineOptions, isLocalEngineConfigured } from "@/lib/local-engine";
import type { CreatifyApiMethod } from "@/lib/supabase/types";

type VideoValues = typeof videos.$inferInsert;

/** A post (or one of its segments) has at most one video that isn't failed. */
async function findActiveVideo(blogPostId: string, segmentId: string | null) {
  const [video] = await db
    .select({ id: videos.id, status: videos.status })
    .from(videos)
    .where(
      and(
        eq(videos.blog_post_id, blogPostId),
        segmentId ? eq(videos.content_segment_id, segmentId) : isNull(videos.content_segment_id),
        ne(videos.status, "failed")
      )
    )
    .limit(1);
  return video ?? null;
}

/** Inserts the video, or renders the post's finished video again in place with the new settings. */
async function saveVideo(existingId: string | null, values: VideoValues) {
  if (!existingId) {
    const [video] = await db.insert(videos).values(values).returning();
    return video;
  }
  const [video] = await db
    .update(videos)
    .set({
      ...values,
      video_url: null,
      creatify_video_url: null,
      duration_seconds: null,
      error_message: null,
      generated_captions: null,
    })
    .where(eq(videos.id, existingId))
    .returning();
  return video;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);
  return code(error) === "23505" || code((error as { cause?: unknown })?.cause) === "23505";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      blogPostId,
      contentSegmentId,
      script,
      apiMethod = "ai_shorts",
      style,
      aspectRatio = "9x16",
      accentId,
      backgroundMusicVolume,
      voiceoverVolume,
      visualStyle,
      videoLength,
      avatarId,
      pacing,
      musicMood,
      voiceProvider,
    } = body as {
      blogPostId: string;
      contentSegmentId?: string;
      script: string;
      apiMethod?: CreatifyApiMethod;
      style: CreatifyStyle;
      aspectRatio?: CreatifyAspectRatio;
      accentId?: string;
      backgroundMusicVolume?: number;
      voiceoverVolume?: number;
      visualStyle?: string;
      videoLength?: number;
      avatarId?: string;
      pacing?: string;
      musicMood?: string;
      voiceProvider?: string;
    };

    if (!blogPostId || !script) {
      return NextResponse.json(
        { error: "Blog post ID and script are required" },
        { status: 400 }
      );
    }

    if (apiMethod === "local") {
      if (!isLocalEngineConfigured()) {
        return NextResponse.json(
          { error: "Local engine is not configured. Add OPENAI_API_KEY to render videos locally." },
          { status: 503 }
        );
      }
    } else {
      if (!isCreatifyConfigured()) {
        return NextResponse.json(
          { error: "Creatify API is not configured" },
          { status: 503 }
        );
      }

      // Check credits before submitting to Creatify
      const credits = await getRemainingCredits();
      if (credits.remaining_credits < 5) {
        return NextResponse.json(
          { error: `Insufficient Creatify credits (${credits.remaining_credits} remaining). Need at least 5.` },
          { status: 402 }
        );
      }
    }

    // Verify the blog post exists and get title + URL
    const [post] = await db
      .select({ id: blog_posts.id, title: blog_posts.title, url: blog_posts.url })
      .from(blog_posts)
      .where(eq(blog_posts.id, blogPostId))
      .limit(1)
      .catch(() => []);

    if (!post) {
      return NextResponse.json(
        { error: "Blog post not found" },
        { status: 404 }
      );
    }

    const segmentId = contentSegmentId || null;
    const active = await findActiveVideo(blogPostId, segmentId);

    // Already rendering, from a double click or a retry while the first request ran: follow that one.
    if (active && (active.status === "pending" || active.status === "generating")) {
      return NextResponse.json({ videoId: active.id, status: active.status });
    }

    if (active) {
      const [scheduled] = await db
        .select({ id: scheduled_posts.id })
        .from(scheduled_posts)
        .where(and(eq(scheduled_posts.video_id, active.id), inArray(scheduled_posts.status, ["pending", "scheduled"])))
        .limit(1);
      if (scheduled) {
        return NextResponse.json(
          { error: "This video is scheduled to post. Remove it from the calendar before making a new one." },
          { status: 409 }
        );
      }
    }

    const values: VideoValues =
      apiMethod === "local"
        ? {
            blog_post_id: blogPostId,
            content_segment_id: segmentId,
            script,
            style: "stock_footage",
            style_options: buildLocalEngineOptions({
              aspectRatio,
              voiceProvider,
              voice: accentId,
              visualStyle,
              pacing,
              music: musicMood,
              musicVolume: backgroundMusicVolume,
            }),
            status: "pending",
            creatify_job_id: null,
          }
        : {
            blog_post_id: blogPostId,
            content_segment_id: segmentId,
            script,
            style: "stock_footage", // Our DB enum
            style_options: {
              apiVersion: apiMethod,
              creatifyStyle: style,
              aspectRatio,
              accentId,
              voiceoverVolume: voiceoverVolume ?? 1.0,
              backgroundMusicVolume: backgroundMusicVolume ?? 0.3,
              visualStyle,
              videoLength,
              avatarId,
            },
            status: "pending",
            creatify_job_id: null,
          };

    let video: typeof videos.$inferSelect | undefined;
    try {
      video = await saveVideo(active?.id ?? null, values);
      if (!video) throw new Error("Failed to create video record");
    } catch (insertError) {
      // Two requests raced past the check above; the other one created the video.
      if (isUniqueViolation(insertError)) {
        const winner = await findActiveVideo(blogPostId, segmentId);
        if (winner) return NextResponse.json({ videoId: winner.id, status: winner.status });
      }
      console.error("Error creating video record:", insertError);
      throw insertError;
    }

    // Move the post out of New, as Auto Mode and the Content page's bulk action do.
    await db
      .update(blog_posts)
      .set({ status: "converting" })
      .where(and(eq(blog_posts.id, blogPostId), eq(blog_posts.status, "new")))
      .catch(() => {});

    if (apiMethod === "local") {
      return NextResponse.json({
        videoId: video.id,
        status: "pending",
      });
    }

    // Start video generation with appropriate Creatify API
    try {
      let creatifyJob;

      switch (apiMethod) {
        case "link_to_video": {
          console.log("[generate] Using Link-to-Video API for:", post.url);

          // Step 1: Create link from blog post URL
          const link = await createLinkFromUrl(post.url);

          // Step 2: Create video from the link
          creatifyJob = await createLinkToVideo({
            link: link.id,
            override_script: script,
            visual_style: visualStyle || "FullScreenTemplate",
            video_length: videoLength || 30,
            aspect_ratio: aspectRatio,
            override_voice: accentId,
          });
          break;
        }

        case "lipsync_v2": {
          console.log("[generate] Using Lipsync V2 API with avatar:", avatarId);

          if (!avatarId) {
            throw new Error("Avatar ID is required for lipsync_v2 method");
          }
          if (!accentId) {
            throw new Error("Voice ID is required for lipsync_v2 method");
          }

          creatifyJob = await createLipsyncV2({
            video_inputs: [
              {
                character: {
                  type: "avatar",
                  avatar_id: avatarId,
                },
                voice: {
                  type: "text",
                  voice_id: accentId,
                  input_text: script,
                },
              },
            ],
            aspect_ratio: aspectRatio,
          });
          break;
        }

        default: {
          // ai_shorts (legacy default)
          console.log("[generate] Using AI Shorts API with style:", style);

          creatifyJob = await createAIShorts({
            script,
            style: style || "4K realistic",
            aspect_ratio: aspectRatio,
            accent: accentId || null,
            background_music_volume: backgroundMusicVolume,
            voiceover_volume: voiceoverVolume,
            name: post.title,
          });
          break;
        }
      }

      console.log("Creatify job created:", {
        id: creatifyJob.id,
        status: creatifyJob.status,
        apiMethod,
      });

      // Update with Creatify job ID
      try {
        await db
          .update(videos)
          .set({
            creatify_job_id: creatifyJob.id,
            status: "generating",
          })
          .where(eq(videos.id, video.id));
      } catch (updateError) {
        console.error("Failed to update video with creatify_job_id:", updateError);
        throw updateError;
      }

      console.log("Video record updated with creatify_job_id:", creatifyJob.id);

      return NextResponse.json({
        videoId: video.id,
        creatifyJobId: creatifyJob.id,
        status: creatifyJob.status,
        progress: creatifyJob.progress,
        creditsUsed: creatifyJob.credits_used,
      });
    } catch (creatifyError) {
      // Update video record with error
      await db
        .update(videos)
        .set({
          status: "failed",
          error_message:
            creatifyError instanceof Error
              ? creatifyError.message
              : "Failed to start video generation",
        })
        .where(eq(videos.id, video.id))
        .catch(() => {});

      return NextResponse.json(
        {
          error: "Failed to start video generation",
          details: creatifyError instanceof Error ? creatifyError.message : String(creatifyError),
          videoId: video.id,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error generating video:", error);
    return NextResponse.json(
      { error: "Failed to generate video" },
      { status: 500 }
    );
  }
}
