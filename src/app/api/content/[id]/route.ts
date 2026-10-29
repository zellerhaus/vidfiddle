import { NextRequest, NextResponse } from "next/server";
import { eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds } from "@/db/schema";
import type { ContentStatus } from "@/lib/supabase/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const [post] = await db
      .select({ ...getTableColumns(blog_posts), rss_feeds })
      .from(blog_posts)
      .leftJoin(rss_feeds, eq(blog_posts.feed_id, rss_feeds.id))
      .where(eq(blog_posts.id, id))
      .limit(1)
      .catch(() => []);

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(post);
  } catch (error) {
    console.error("Error fetching post:", error);
    return NextResponse.json(
      { error: "Failed to fetch post" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body as { status?: ContentStatus };

    // Only update status for now (safe partial update)
    const updateData: { status?: ContentStatus } = {};
    if (status) updateData.status = status;

    const [post] = await db
      .update(blog_posts)
      .set(updateData)
      .where(eq(blog_posts.id, id))
      .returning();

    if (!post) throw new Error("Post not found");

    return NextResponse.json(post);
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json(
      { error: "Failed to update post" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await db.delete(blog_posts).where(eq(blog_posts.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json(
      { error: "Failed to delete post" },
      { status: 500 }
    );
  }
}
