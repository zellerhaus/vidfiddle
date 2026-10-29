import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, content_segments } from "@/db/schema";
import { segmentContent } from "@/lib/content-segmenter";
import type { ContentSegmentInsert, ContentSegment } from "@/lib/supabase/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SegmentRequestBody {
  maxSegments?: number;
  targetDurationPerSegment?: number;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as SegmentRequestBody;

    // Validate maxSegments (1-5, default 3)
    const maxSegments = body.maxSegments ?? 3;
    if (maxSegments < 1 || maxSegments > 5) {
      return NextResponse.json(
        { error: "maxSegments must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Target duration per segment (default 60 seconds)
    const targetDurationPerSegment = body.targetDurationPerSegment ?? 60;

    // Fetch the blog post content
    const [post] = await db
      .select({ id: blog_posts.id, title: blog_posts.title, content: blog_posts.content })
      .from(blog_posts)
      .where(eq(blog_posts.id, id))
      .limit(1)
      .catch(() => []);

    if (!post) {
      return NextResponse.json(
        { error: "Blog post not found" },
        { status: 404 }
      );
    }

    // Delete any existing segments for this blog post (to allow re-segmentation)
    await db
      .delete(content_segments)
      .where(eq(content_segments.blog_post_id, id))
      .catch(() => {});

    // Call Claude to segment the content
    const segmentResults = await segmentContent({
      title: post.title,
      content: post.content,
      maxSegments,
      targetDurationPerSegment,
    });

    // Insert segments into the database
    const segmentsToInsert: ContentSegmentInsert[] = segmentResults.map(
      (segment, index) => ({
        blog_post_id: id,
        segment_index: index,
        title: segment.title,
        content: segment.content,
        key_points: segment.keyPoints,
      })
    );

    let createdSegments: ContentSegment[];
    try {
      createdSegments = segmentsToInsert.length === 0 ? [] : await db
        .insert(content_segments)
        .values(segmentsToInsert)
        .returning();
    } catch (insertError) {
      console.error("Error inserting segments:", insertError);
      return NextResponse.json(
        { error: "Failed to save segments" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      segments: createdSegments as ContentSegment[],
      count: createdSegments?.length ?? 0,
    });
  } catch (error) {
    console.error("Error segmenting content:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error);
    return NextResponse.json(
      { error: "Failed to segment content", details: errorMessage },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve existing segments for a blog post
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const segments = await db
      .select()
      .from(content_segments)
      .where(eq(content_segments.blog_post_id, id))
      .orderBy(asc(content_segments.segment_index));

    return NextResponse.json({
      segments: segments as ContentSegment[],
      count: segments?.length ?? 0,
    });
  } catch (error) {
    console.error("Error fetching segments:", error);
    return NextResponse.json(
      { error: "Failed to fetch segments" },
      { status: 500 }
    );
  }
}
