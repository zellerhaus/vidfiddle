import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds } from "@/db/schema";
import { parseFeed, feedItemToBlogPost } from "@/lib/rss";

export async function GET() {
  try {
    const feeds = await db
      .select()
      .from(rss_feeds)
      .orderBy(desc(rss_feeds.created_at));

    return NextResponse.json(feeds);
  } catch (error) {
    console.error("Error fetching feeds:", error);
    return NextResponse.json(
      { error: "Failed to fetch feeds" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      url,
      auto_mode_enabled = false,
      auto_videos_per_post = 1,
      auto_platforms = [],
      initial_import_limit = 10,
    } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Feed URL is required" },
        { status: 400 }
      );
    }

    // Validate auto mode settings
    if (typeof auto_mode_enabled !== "boolean") {
      return NextResponse.json(
        { error: "auto_mode_enabled must be a boolean" },
        { status: 400 }
      );
    }

    if (
      typeof auto_videos_per_post !== "number" ||
      auto_videos_per_post < 1 ||
      auto_videos_per_post > 5
    ) {
      return NextResponse.json(
        { error: "auto_videos_per_post must be between 1 and 5" },
        { status: 400 }
      );
    }

    if (!Array.isArray(auto_platforms)) {
      return NextResponse.json(
        { error: "auto_platforms must be an array" },
        { status: 400 }
      );
    }

    // Validate initial_import_limit (0 = unlimited, otherwise 10-500)
    if (
      typeof initial_import_limit !== "number" ||
      (initial_import_limit !== 0 &&
        (initial_import_limit < 10 || initial_import_limit > 500))
    ) {
      return NextResponse.json(
        { error: "initial_import_limit must be 0 (unlimited) or between 10 and 500" },
        { status: 400 }
      );
    }

    // Validate and parse the feed
    let feedData;
    try {
      feedData = await parseFeed(url);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid RSS feed URL or format" },
        { status: 400 }
      );
    }

    // Check if feed already exists
    const [existing] = await db
      .select({ id: rss_feeds.id })
      .from(rss_feeds)
      .where(eq(rss_feeds.url, url))
      .limit(1)
      .catch(() => []);

    if (existing) {
      return NextResponse.json(
        { error: "This feed has already been added" },
        { status: 409 }
      );
    }

    // Insert the feed
    const [feed] = await db
      .insert(rss_feeds)
      .values({
        url,
        title: feedData.title || null,
        last_checked_at: new Date().toISOString(),
        auto_mode_enabled,
        auto_videos_per_post,
        auto_platforms,
      })
      .returning();

    if (!feed) throw new Error("Failed to add feed");

    // Import initial posts from the feed
    if (feedData.items.length > 0) {
      // If initial_import_limit is 0, import all posts; otherwise respect the limit
      const itemsToImport =
        initial_import_limit === 0
          ? feedData.items
          : feedData.items.slice(0, initial_import_limit);
      const posts = itemsToImport.map((item) =>
        feedItemToBlogPost(item, feed.id)
      );

      // Insert posts, ignoring duplicates
      await db
        .insert(blog_posts)
        .values(posts)
        .onConflictDoNothing({ target: blog_posts.url })
        .catch(() => undefined);
    }

    return NextResponse.json(feed, { status: 201 });
  } catch (error) {
    console.error("Error adding feed:", error);
    return NextResponse.json(
      { error: "Failed to add feed" },
      { status: 500 }
    );
  }
}
