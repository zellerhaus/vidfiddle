import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, content_segments, generation_queue } from "@/db/schema";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: blogPostId } = await params;
    // Fetch all segments for this blog post
    const segments = await db
      .select()
      .from(content_segments)
      .where(eq(content_segments.blog_post_id, blogPostId))
      .orderBy(asc(content_segments.segment_index));

    if (!segments || segments.length === 0) {
      return NextResponse.json(
        { error: "No segments found for this blog post" },
        { status: 404 }
      );
    }

    // Check if any segments are already in the queue
    const segmentIds = segments.map((s) => s.id);
    const existingQueue = await db
      .select({ segment_id: generation_queue.segment_id })
      .from(generation_queue)
      .where(and(
        inArray(generation_queue.segment_id, segmentIds),
        inArray(generation_queue.status, ["pending", "processing"])
      ));

    const existingSegmentIds = new Set(existingQueue?.map((q) => q.segment_id) || []);
    const newSegments = segments.filter((s) => !existingSegmentIds.has(s.id));

    if (newSegments.length === 0) {
      return NextResponse.json(
        { error: "All segments are already in the queue" },
        { status: 409 }
      );
    }

    // Create queue items for each segment
    const queueItems = newSegments.map((segment, index) => ({
      blog_post_id: blogPostId,
      segment_id: segment.id,
      status: "pending" as const,
      priority: index + 1, // Lower number = higher priority
      attempts: 0,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
    }));

    const insertedItems = await db
      .insert(generation_queue)
      .values(queueItems)
      .returning();

    // Update blog post status to 'converting'
    await db
      .update(blog_posts)
      .set({ status: "converting" })
      .where(eq(blog_posts.id, blogPostId))
      .catch(() => {});

    return NextResponse.json({
      success: true,
      queued: insertedItems?.length ?? 0,
      skipped: existingSegmentIds.size,
      message: `Added ${insertedItems?.length ?? 0} segment(s) to queue`,
    });
  } catch (error) {
    console.error("Error adding segments to queue:", error);
    return NextResponse.json(
      { error: "Failed to add segments to queue" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: blogPostId } = await params;
    // Fetch all segments for this blog post
    const segments = await db
      .select({ id: content_segments.id })
      .from(content_segments)
      .where(eq(content_segments.blog_post_id, blogPostId));

    if (!segments || segments.length === 0) {
      return NextResponse.json({ statuses: {} });
    }

    // Get queue status for each segment
    const segmentIds = segments.map((s) => s.id);
    const queueItems = await db
      .select({
        segment_id: generation_queue.segment_id,
        status: generation_queue.status,
        error_message: generation_queue.error_message,
        created_at: generation_queue.created_at,
      })
      .from(generation_queue)
      .where(inArray(generation_queue.segment_id, segmentIds))
      .orderBy(desc(generation_queue.created_at));

    // Build status map (use most recent status for each segment)
    const statuses: Record<string, { status: string; error?: string }> = {};
    for (const item of queueItems || []) {
      if (item.segment_id && !statuses[item.segment_id]) {
        statuses[item.segment_id] = {
          status: item.status,
          error: item.error_message ?? undefined,
        };
      }
    }

    return NextResponse.json({ statuses });
  } catch (error) {
    console.error("Error fetching queue status:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue status" },
      { status: 500 }
    );
  }
}
