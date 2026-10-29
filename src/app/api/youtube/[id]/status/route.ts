import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { youtube_clips, youtube_sources } from "@/db/schema";

/**
 * GET /api/youtube/[id]/status
 * Poll the processing status of a YouTube source.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [source] = await db
      .select()
      .from(youtube_sources)
      .where(eq(youtube_sources.id, id))
      .limit(1)
      .catch(() => []);

    if (!source) {
      return NextResponse.json(
        { error: "YouTube source not found" },
        { status: 404 }
      );
    }

    // Get clip counts by status
    const clips = await db
      .select({
        id: youtube_clips.id,
        status: youtube_clips.status,
        title: youtube_clips.title,
        viral_score: youtube_clips.viral_score,
        duration_seconds: youtube_clips.duration_seconds,
      })
      .from(youtube_clips)
      .where(eq(youtube_clips.youtube_source_id, id))
      .orderBy(asc(youtube_clips.clip_index))
      .catch(() => null);

    const clipSummary = {
      total: clips?.length || 0,
      pending: clips?.filter((c) => c.status === "pending").length || 0,
      cutting: clips?.filter((c) => c.status === "cutting").length || 0,
      renderingCaptions:
        clips?.filter((c) => c.status === "rendering_captions").length || 0,
      completed: clips?.filter((c) => c.status === "completed").length || 0,
      failed: clips?.filter((c) => c.status === "failed").length || 0,
    };

    return NextResponse.json({
      id: source.id,
      youtubeUrl: source.youtube_url,
      youtubeVideoId: source.youtube_video_id,
      title: source.title,
      channelName: source.channel_name,
      durationSeconds: source.duration_seconds,
      status: source.status,
      errorMessage: source.error_message,
      clips: clipSummary,
      createdAt: source.created_at,
    });
  } catch (error) {
    console.error("Error fetching YouTube status:", error);
    return NextResponse.json(
      { error: "Failed to fetch status" },
      { status: 500 }
    );
  }
}
