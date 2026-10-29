import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: videoId } = await params;

    if (!videoId) {
      return NextResponse.json(
        { error: "Video ID is required" },
        { status: 400 }
      );
    }

    // Parse request body for reason
    const body = await request.json();
    const { reason } = body;

    if (!reason || typeof reason !== "string") {
      return NextResponse.json(
        { error: "Reason is required" },
        { status: 400 }
      );
    }

    // Fetch the video to verify it exists and is pending review
    const [video] = await db
      .select({ id: videos.id, approval_status: videos.approval_status })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
      .catch((videoError) => {
        console.error("Error fetching video:", videoError);
        return [];
      });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Check if video is pending review
    if (video.approval_status !== "pending_review") {
      return NextResponse.json(
        { error: "Video is not pending review" },
        { status: 400 }
      );
    }

    // Update video with rejection status and reason
    await db
      .update(videos)
      .set({
        approval_status: "rejected",
        rejection_reason: reason,
      })
      .where(eq(videos.id, videoId));

    return NextResponse.json({
      success: true,
      message: "Video rejected",
      videoId,
      reason,
    });
  } catch (error) {
    console.error("Error rejecting video:", error);
    return NextResponse.json(
      { error: "Failed to reject video" },
      { status: 500 }
    );
  }
}
