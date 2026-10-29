import { NextRequest, NextResponse } from "next/server";
import { eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, videos } from "@/db/schema";
import {
  getAIShortsById,
  getLinkToVideoById,
  getLipsyncV2ById,
  isJobComplete,
  isJobSuccessful,
} from "@/lib/creatify";
import { isLocalEngineOptions } from "@/lib/local-engine";
import {
  transferVideoToStorage,
  isStorageConfigured,
  keyFromUrl,
} from "@/lib/storage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const [video] = await db
      .select({ ...getTableColumns(videos), blog_posts })
      .from(videos)
      .leftJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .where(eq(videos.id, id))
      .limit(1)
      .catch(() => []);

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error("Error fetching video:", error);
    return NextResponse.json(
      { error: "Failed to fetch video" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  // Update video script
  try {
    const { id } = await params;
    const body = await request.json();
    const { script } = body;

    if (!script || typeof script !== "string") {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 }
      );
    }

    const [video] = await db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1)
      .catch(() => []);

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    let updatedVideo: typeof videos.$inferSelect | undefined;
    try {
      [updatedVideo] = await db
        .update(videos)
        .set({ script })
        .where(eq(videos.id, id))
        .returning();

      if (!updatedVideo) throw new Error("Video not found");
    } catch (updateError) {
      console.error("Error updating video script:", updateError);
      return NextResponse.json(
        { error: "Failed to update script" },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedVideo);
  } catch (error) {
    console.error("Error updating video:", error);
    return NextResponse.json(
      { error: "Failed to update video" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  // Refresh status from Creatify
  try {
    const { id } = await params;
    const [video] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1)
      .catch((error) => {
        console.error("Video not found:", id, error);
        return [];
      });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    console.log("Video status check:", {
      id: video.id,
      status: video.status,
      creatify_job_id: video.creatify_job_id,
    });

    if (isLocalEngineOptions(video.style_options)) {
      return NextResponse.json(video);
    }

    if (!video.creatify_job_id) {
      // Video might still be pending - return current status
      if (video.status === "pending") {
        return NextResponse.json({
          ...video,
          creatifyStatus: "pending",
          creatifyProgress: 0,
        });
      }
      // If failed, return the error
      if (video.status === "failed") {
        return NextResponse.json({
          ...video,
          creatifyStatus: "failed",
          creatifyProgress: 0,
        });
      }
      return NextResponse.json(
        { error: "Video has no associated Creatify job", status: video.status },
        { status: 400 }
      );
    }

    // Determine which API was used from style_options
    const styleOptions = video.style_options as Record<string, unknown> | null;
    const apiVersion = (styleOptions?.apiVersion as string) || "ai_shorts";

    // Get status from the appropriate Creatify API
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
      return NextResponse.json(
        { error: "Creatify job not found" },
        { status: 404 }
      );
    }

    // Map Creatify status to our status
    type VideoStatusType = "pending" | "generating" | "completed" | "failed";
    let newStatus: VideoStatusType = video.status as VideoStatusType;

    if (isJobSuccessful(creatifyJob.status)) {
      newStatus = "completed";
    } else if (isJobComplete(creatifyJob.status) && !isJobSuccessful(creatifyJob.status)) {
      newStatus = "failed";
    } else if (creatifyJob.status === "running" || creatifyJob.status === "in_queue") {
      newStatus = "generating";
    }

    // Determine the video URL to use
    let finalVideoUrl = video.video_url;
    let creatifyVideoUrl = video.creatify_video_url;

    // If job is successful and we have a Creatify video URL, download and store
    if (
      isJobSuccessful(creatifyJob.status) &&
      creatifyJob.video_output &&
      keyFromUrl(video.video_url ?? "") === null // Don't re-download if already stored
    ) {
      // Store original Creatify URL
      creatifyVideoUrl = creatifyJob.video_output;

      // Try to transfer to storage
      const storageConfigured = await isStorageConfigured();

      if (storageConfigured) {
        try {
          console.log("[Video] Transferring video to storage...");
          finalVideoUrl = await transferVideoToStorage(creatifyJob.video_output, id);
          console.log("[Video] Video transferred successfully:", finalVideoUrl);
        } catch (storageError) {
          console.error("[Video] Failed to transfer video to storage:", storageError);
          // Fall back to Creatify URL
          finalVideoUrl = creatifyJob.video_output;
        }
      } else {
        console.warn("[Video] Storage not configured, using Creatify URL directly");
        finalVideoUrl = creatifyJob.video_output;
      }
    }

    // Update video record
    const updatePayload = {
      status: newStatus,
      video_url: finalVideoUrl || video.video_url,
      creatify_video_url: creatifyVideoUrl || video.creatify_video_url,
      duration_seconds: creatifyJob.duration ?? video.duration_seconds,
      error_message: creatifyJob.failed_reason ?? video.error_message ?? null,
    };

    console.log("[Video] Updating video with:", updatePayload);

    let updatedVideo: typeof videos.$inferSelect | undefined;
    try {
      [updatedVideo] = await db
        .update(videos)
        .set(updatePayload)
        .where(eq(videos.id, id))
        .returning();

      if (!updatedVideo) {
        throw {
          code: "PGRST116",
          details: "The result contains 0 rows",
          hint: null,
          message: "Cannot coerce the result to a single JSON object",
        };
      }
    } catch (updateError) {
      console.error("[Video] Database update error:", updateError);
      throw updateError;
    }

    return NextResponse.json({
      ...updatedVideo,
      creatifyStatus: creatifyJob.status,
      creatifyProgress: creatifyJob.progress,
      previewUrl: creatifyJob.preview,
      editorUrl: creatifyJob.editor_url,
      creditsUsed: creatifyJob.credits_used,
    });
  } catch (error) {
    console.error("Error refreshing video status:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error);
    return NextResponse.json(
      { error: "Failed to refresh video status", details: errorMessage },
      { status: 500 }
    );
  }
}
