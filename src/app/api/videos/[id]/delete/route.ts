import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scheduled_posts, videos } from "@/db/schema";
import { deleteVideoFromStorage, keyFromUrl } from "@/lib/storage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // Get video first to check if we need to delete from storage
    const [video] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1)
      .catch(() => []);

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Delete from storage if the URL is from our storage
    if (video.video_url && keyFromUrl(video.video_url) !== null) {
      try {
        await deleteVideoFromStorage(id);
      } catch (storageError) {
        console.error("Failed to delete from storage:", storageError);
        // Continue with database deletion even if storage fails
      }
    }

    // Delete scheduled posts first (foreign key constraint)
    await db
      .delete(scheduled_posts)
      .where(eq(scheduled_posts.video_id, id))
      .catch(() => {});

    // Delete the video record
    await db
      .delete(videos)
      .where(eq(videos.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting video:", error);
    return NextResponse.json(
      { error: "Failed to delete video" },
      { status: 500 }
    );
  }
}
