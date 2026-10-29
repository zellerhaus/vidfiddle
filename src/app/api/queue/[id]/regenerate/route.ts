import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, content_segments, settings, videos } from "@/db/schema";
import {
  createAIShorts,
  createLinkFromUrl,
  createLinkToVideo,
  createLipsyncV2,
  mapAspectRatio,
  type CreatifyStyle,
} from "@/lib/creatify";
import { generateScript, type ScriptGenerationParams } from "@/lib/claude";
import { isLocalEngineConfigured, toAspectRatio, toOpenAIVoice } from "@/lib/local-engine";
import type { VideoDefaults, CreatifyApiMethod } from "@/lib/supabase/types";

type RouteParams = { params: Promise<{ id: string }> };

interface VideoWithRelations {
  id: string;
  script: string;
  style_options: Record<string, unknown> | null;
  approval_status: string;
  generation_attempt: number;
  blog_post_id: string;
  content_segment_id: string | null;
  blog_posts: {
    id: string;
    title: string;
    content: string;
    url: string;
  };
  content_segments?: {
    id: string;
    title: string;
    content: string;
  } | null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: videoId } = await params;

    if (!videoId) {
      return NextResponse.json(
        { error: "Video ID is required" },
        { status: 400 }
      );
    }

    // Parse request body for feedback
    const body = await request.json();
    const { feedback } = body;

    if (!feedback || typeof feedback !== "string") {
      return NextResponse.json(
        { error: "Feedback is required" },
        { status: 400 }
      );
    }

    // Fetch the video with blog post and segment content
    const [video] = await db
      .select({
        id: videos.id,
        script: videos.script,
        style_options: videos.style_options,
        approval_status: videos.approval_status,
        generation_attempt: videos.generation_attempt,
        blog_post_id: videos.blog_post_id,
        content_segment_id: videos.content_segment_id,
        blog_posts: {
          id: blog_posts.id,
          title: blog_posts.title,
          content: blog_posts.content,
          url: blog_posts.url,
        },
        content_segments: {
          id: content_segments.id,
          title: content_segments.title,
          content: content_segments.content,
        },
      })
      .from(videos)
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .leftJoin(content_segments, eq(videos.content_segment_id, content_segments.id))
      .where(eq(videos.id, videoId))
      .limit(1)
      .catch((videoError) => {
        console.error("Error fetching video:", videoError);
        return [];
      });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const typedVideo = video as VideoWithRelations;

    // Check if video is pending review (allow regeneration)
    if (typedVideo.approval_status !== "pending_review") {
      return NextResponse.json(
        { error: "Video is not pending review" },
        { status: 400 }
      );
    }

    // Store feedback in regeneration_feedback column
    await db
      .update(videos)
      .set({ regeneration_feedback: feedback })
      .where(eq(videos.id, videoId))
      .catch(() => {});

    // Get video defaults for script generation
    const [settingsData] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "video_defaults"))
      .limit(1)
      .catch(() => []);

    const defaults = settingsData?.value as unknown as VideoDefaults | undefined;

    // Determine content source: segment or blog post
    const contentSource = typedVideo.content_segment_id
      ? typedVideo.content_segments
      : typedVideo.blog_posts;

    if (!contentSource) {
      return NextResponse.json(
        { error: "Content source not found" },
        { status: 404 }
      );
    }

    // Generate improved script with feedback context
    const scriptParams: ScriptGenerationParams = {
      title: contentSource.title,
      content: buildContentWithFeedback(
        contentSource.content,
        typedVideo.script,
        feedback
      ),
      targetDuration: defaults?.targetDuration || 45,
      style: mapScriptStyle(defaults?.scriptStyle),
      tone: mapScriptTone(defaults?.scriptTone),
    };

    const scriptResult = await generateScript(scriptParams);

    // Get style options from video or defaults
    const styleOptions = typedVideo.style_options || {};
    const apiMethod = ((styleOptions.apiVersion as string) ||
      defaults?.apiMethod ||
      "ai_shorts") as CreatifyApiMethod;
    const style = (styleOptions.creatifyStyle ||
      defaults?.creatifyStyle ||
      "4K realistic") as CreatifyStyle;
    const aspectRatio = mapAspectRatio(
      (styleOptions.aspectRatio as string) ||
        defaults?.aspectRatio ||
        "9:16"
    );
    const voiceId =
      (styleOptions.voiceId as string) || defaults?.voiceId || null;
    const voiceoverVolume =
      (styleOptions.voiceoverVolume as number) ??
      (defaults?.voiceoverVolume ? defaults.voiceoverVolume / 100 : 0.8);
    const backgroundMusicVolume =
      (styleOptions.backgroundMusicVolume as number) ??
      (defaults?.backgroundMusicVolume
        ? defaults.backgroundMusicVolume / 100
        : 0.3);

    if (apiMethod === "local") {
      if (!isLocalEngineConfigured()) {
        return NextResponse.json(
          { error: "Local engine is not configured. Add OPENAI_API_KEY to render videos locally." },
          { status: 503 }
        );
      }

      const newAttempt = typedVideo.generation_attempt + 1;
      const voice = toOpenAIVoice(
        (styleOptions.voice as string) ||
        (styleOptions.voiceId as string) ||
        (styleOptions.accentId as string) ||
        defaults?.voiceId ||
        undefined
      );

      try {
        await db
          .update(videos)
          .set({
            script: scriptResult.script,
            status: "pending",
            creatify_job_id: null,
            creatify_video_url: null,
            video_url: null,
            style_options: {
              apiVersion: "local",
              aspectRatio: toAspectRatio(
                (styleOptions.aspectRatio as string) ||
                  defaults?.aspectRatio ||
                  "9:16"
              ),
              voice,
              visualStyle: localVisualStyle(
                (styleOptions.visualStyle as string) ||
                  defaults?.visualStyle ||
                  undefined
              ),
            },
            generation_attempt: newAttempt,
            error_message: null,
          })
          .where(eq(videos.id, videoId));
      } catch (updateError) {
        console.error("Error updating video:", updateError);
        return NextResponse.json(
          { error: "Failed to update video" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Video regeneration queued",
        videoId,
        status: "pending",
        generationAttempt: newAttempt,
        newScript: scriptResult.script,
      });
    }

    // Trigger new Creatify video generation using the same API method
    let creatifyJob;

    switch (apiMethod) {
      case "link_to_video": {
        const link = await createLinkFromUrl(typedVideo.blog_posts.url);
        creatifyJob = await createLinkToVideo({
          link: link.id,
          override_script: scriptResult.script,
          visual_style: (styleOptions.visualStyle as string) || defaults?.visualStyle || "FullScreenTemplate",
          video_length: (styleOptions.videoLength as number) || defaults?.videoLength || 30,
          aspect_ratio: aspectRatio,
          override_voice: voiceId || undefined,
        });
        break;
      }

      case "lipsync_v2": {
        const avatarId = (styleOptions.avatarId as string) || defaults?.avatarId;
        if (!avatarId) {
          throw new Error("Avatar ID is required for lipsync_v2 regeneration");
        }
        if (!voiceId) {
          throw new Error("Voice ID is required for lipsync_v2 regeneration");
        }

        creatifyJob = await createLipsyncV2({
          video_inputs: [
            {
              character: { type: "avatar", avatar_id: avatarId },
              voice: { type: "text", voice_id: voiceId, input_text: scriptResult.script },
            },
          ],
          aspect_ratio: aspectRatio,
        });
        break;
      }

      default: {
        creatifyJob = await createAIShorts({
          script: scriptResult.script,
          aspect_ratio: aspectRatio,
          style,
          accent: voiceId,
          voiceover_volume: voiceoverVolume,
          background_music_volume: backgroundMusicVolume,
        });
        break;
      }
    }

    // Update video record with new job info
    const newAttempt = typedVideo.generation_attempt + 1;

    try {
      await db
        .update(videos)
        .set({
          script: scriptResult.script,
          status: "generating",
          creatify_job_id: creatifyJob.id,
          creatify_video_url: null,
          video_url: null,
          approval_status: "pending_review",
          generation_attempt: newAttempt,
          error_message: null,
        })
        .where(eq(videos.id, videoId));
    } catch (updateError) {
      console.error("Error updating video:", updateError);
      return NextResponse.json(
        { error: "Failed to update video" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Video regeneration started",
      videoId,
      creatifyJobId: creatifyJob.id,
      generationAttempt: newAttempt,
      newScript: scriptResult.script,
    });
  } catch (error) {
    console.error("Error regenerating video:", error);
    return NextResponse.json(
      { error: "Failed to regenerate video" },
      { status: 500 }
    );
  }
}

/**
 * Build content with feedback context for Claude
 * Includes original content, previous script, and user feedback
 */
function buildContentWithFeedback(
  originalContent: string,
  previousScript: string,
  feedback: string
): string {
  return `${originalContent}

---
PREVIOUS SCRIPT (needs improvement based on feedback):
${previousScript}

---
USER FEEDBACK FOR IMPROVEMENT:
${feedback}

---
IMPORTANT: Generate an improved script that addresses the user's feedback while maintaining the key messages from the original content. Focus specifically on the improvements requested.`;
}

/**
 * Map script style from defaults to Claude's style parameter
 */
function mapScriptStyle(
  style?: string
): "informative" | "entertaining" | "professional" {
  const styleMap: Record<string, "informative" | "entertaining" | "professional"> = {
    informative: "informative",
    educational: "informative",
    engaging: "entertaining",
    entertaining: "entertaining",
    professional: "professional",
    formal: "professional",
  };
  return styleMap[style?.toLowerCase() || ""] || "informative";
}

/**
 * Map script tone from defaults to Claude's tone parameter
 */
function mapScriptTone(tone?: string): "casual" | "formal" | "energetic" {
  const toneMap: Record<string, "casual" | "formal" | "energetic"> = {
    casual: "casual",
    conversational: "casual",
    formal: "formal",
    professional: "formal",
    energetic: "energetic",
    enthusiastic: "energetic",
  };
  return toneMap[tone?.toLowerCase() || ""] || "casual";
}

function localVisualStyle(value?: string): string | undefined {
  return value && value !== "FullScreenTemplate" ? value : undefined;
}
