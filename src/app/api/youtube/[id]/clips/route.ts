import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { youtube_clips, youtube_sources } from "@/db/schema";

/**
 * GET /api/youtube/[id]/clips
 * List all clips for a YouTube source.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify source exists
    const [source] = await db
      .select({
        id: youtube_sources.id,
        title: youtube_sources.title,
        youtube_url: youtube_sources.youtube_url,
      })
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

    // Fetch all clips
    const clips = await db
      .select()
      .from(youtube_clips)
      .where(eq(youtube_clips.youtube_source_id, id))
      .orderBy(asc(youtube_clips.clip_index))
      .catch(() => null);

    if (!clips) {
      return NextResponse.json(
        { error: "Failed to fetch clips" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      source: {
        id: source.id,
        title: source.title,
        youtubeUrl: source.youtube_url,
      },
      clips: clips || [],
    });
  } catch (error) {
    console.error("Error fetching clips:", error);
    return NextResponse.json(
      { error: "Failed to fetch clips" },
      { status: 500 }
    );
  }
}
