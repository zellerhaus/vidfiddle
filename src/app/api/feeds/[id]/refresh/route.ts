import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds } from "@/db/schema";
import { parseFeed, feedItemToBlogPost } from "@/lib/rss";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Get the feed
    const [feed] = await db
      .select()
      .from(rss_feeds)
      .where(eq(rss_feeds.id, id))
      .limit(1)
      .catch(() => []);

    if (!feed) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    // Parse the feed
    let feedData;
    try {
      feedData = await parseFeed(feed.url);
    } catch (error) {
      return NextResponse.json(
        { error: "Failed to parse feed" },
        { status: 500 }
      );
    }

    // Get existing post URLs for this feed
    const existingPosts = await db
      .select({ url: blog_posts.url })
      .from(blog_posts)
      .where(eq(blog_posts.feed_id, id))
      .catch(() => null);

    const existingUrls = new Set(existingPosts?.map((p) => p.url) || []);

    // Filter to only new posts
    const newItems = feedData.items.filter(
      (item) => item.link && !existingUrls.has(item.link)
    );

    // Insert new posts
    if (newItems.length > 0) {
      const posts = newItems.map((item) => feedItemToBlogPost(item, id));
      await db.insert(blog_posts).values(posts).catch(() => undefined);
    }

    // Update last_checked_at
    await db
      .update(rss_feeds)
      .set({
        last_checked_at: new Date().toISOString(),
        title: feedData.title || feed.title,
      })
      .where(eq(rss_feeds.id, id))
      .catch(() => undefined);

    return NextResponse.json({
      success: true,
      newPosts: newItems.length,
    });
  } catch (error) {
    console.error("Error refreshing feed:", error);
    return NextResponse.json(
      { error: "Failed to refresh feed" },
      { status: 500 }
    );
  }
}
