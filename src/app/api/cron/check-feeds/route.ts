import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, type DbClient } from "@/db";
import {
  blog_posts as blog_posts_table,
  content_segments as content_segments_table,
  generation_queue as generation_queue_table,
  rss_feeds as rss_feeds_table,
} from "@/db/schema";
import { parseFeed, feedItemToBlogPost } from "@/lib/rss";
import { segmentContent } from "@/lib/content-segmenter";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";
import type {
  RssFeed,
  BlogPost,
  GenerationQueueItemInsert,
  ContentSegmentInsert,
} from "@/lib/supabase/types";

/**
 * Cron endpoint to check RSS feeds for new posts and queue auto-generation.
 * Protected by CRON_SECRET header verification.
 *
 * This runs hourly and:
 * 1. Fetches all feeds with auto_mode_enabled=true
 * 2. Checks for new posts since last_checked_at
 * 3. Segments content if auto_videos_per_post > 1
 * 4. Adds items to generation_queue
 * 5. Marks blog posts as status='converting'
 */
export async function GET(request: NextRequest) {
  // Start cron log
  const logContext = await startCronLog("check-feeds");

  try {
    // Verify CRON_SECRET (Vercel sends it as Authorization: Bearer <secret>)
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.error("CRON_SECRET environment variable not configured");
      addError(logContext, "CRON_SECRET not configured");
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const cronSecret =
      authHeader?.replace("Bearer ", "") ||
      request.headers.get("x-cron-secret");

    if (cronSecret !== expectedSecret) {
      addError(logContext, "Unauthorized request");
      await completeCronLog(logContext, "error");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch all feeds with auto mode enabled
    let feeds: RssFeed[];
    try {
      feeds = await db
        .select()
        .from(rss_feeds_table)
        .where(eq(rss_feeds_table.auto_mode_enabled, true));
    } catch (feedsError) {
      console.error("Error fetching feeds:", feedsError);
      const errorMessage =
        feedsError instanceof Error ? feedsError.message : "Unknown database error";
      addError(logContext, `Failed to fetch feeds: ${errorMessage}`);
      await completeCronLog(logContext, "error");
      return NextResponse.json(
        { error: "Failed to fetch feeds" },
        { status: 500 }
      );
    }

    setSummary(logContext, "feedsChecked", feeds?.length ?? 0);

    if (!feeds || feeds.length === 0) {
      await completeCronLog(logContext);
      return NextResponse.json({
        success: true,
        message: "No auto-mode feeds configured",
        processed: 0,
        queued: 0,
      });
    }

    let totalNewPosts = 0;
    let totalQueued = 0;
    const feedResults: Array<{
      feedId: string;
      feedTitle: string | null;
      newPosts: number;
      queued: number;
      error?: string;
    }> = [];

    // Process each auto-mode feed
    for (const feed of feeds) {
      try {
        const result = await processFeed(db, feed);
        feedResults.push({
          feedId: feed.id,
          feedTitle: feed.title,
          newPosts: result.newPosts,
          queued: result.queued,
        });
        totalNewPosts += result.newPosts;
        totalQueued += result.queued;
        incrementProcessed(logContext);
      } catch (error) {
        console.error(`Error processing feed ${feed.id}:`, error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        feedResults.push({
          feedId: feed.id,
          feedTitle: feed.title,
          newPosts: 0,
          queued: 0,
          error: errorMsg,
        });
        addError(logContext, `Feed ${feed.id}: ${errorMsg}`);
      }
    }

    setSummary(logContext, "newPosts", totalNewPosts);
    setSummary(logContext, "queued", totalQueued);
    await completeCronLog(logContext);

    return NextResponse.json({
      success: true,
      processed: feeds.length,
      totalNewPosts,
      totalQueued,
      feeds: feedResults,
    });
  } catch (error) {
    console.error("Error in check-feeds cron:", error);
    addError(logContext, error instanceof Error ? error.message : "Unknown error");
    await completeCronLog(logContext, "error");
    return NextResponse.json(
      { error: "Failed to process feeds" },
      { status: 500 }
    );
  }
}

/**
 * Process a single feed: check for new posts, segment if needed, and queue for generation.
 */
async function processFeed(
  database: DbClient,
  feed: RssFeed
): Promise<{ newPosts: number; queued: number }> {
  // Parse the feed
  let feedData;
  try {
    feedData = await parseFeed(feed.url);
  } catch (error) {
    throw new Error(`Failed to parse feed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // Get existing post URLs for this feed
  let existingPosts: { url: string }[] | undefined;
  try {
    existingPosts = await database
      .select({ url: blog_posts_table.url })
      .from(blog_posts_table)
      .where(eq(blog_posts_table.feed_id, feed.id));
  } catch {
    existingPosts = undefined;
  }

  const existingUrls = new Set(existingPosts?.map((p) => p.url) || []);

  // Filter to only new posts
  const newItems = feedData.items.filter(
    (item) => item.link && !existingUrls.has(item.link)
  );

  if (newItems.length === 0) {
    // Update last_checked_at even if no new posts
    try {
      await database
        .update(rss_feeds_table)
        .set({ last_checked_at: new Date().toISOString() })
        .where(eq(rss_feeds_table.id, feed.id));
    } catch {
      // Preserve prior behavior: update failures were ignored
    }

    return { newPosts: 0, queued: 0 };
  }

  // Insert new posts
  const posts = newItems.map((item) => feedItemToBlogPost(item, feed.id));
  let insertedPosts: BlogPost[];
  try {
    insertedPosts = await database
      .insert(blog_posts_table)
      .values(posts)
      .returning();
  } catch (insertError) {
    throw new Error(
      `Failed to insert posts: ${insertError instanceof Error ? insertError.message : "Unknown error"}`
    );
  }

  // Update last_checked_at
  try {
    await database
      .update(rss_feeds_table)
      .set({
        last_checked_at: new Date().toISOString(),
        title: feedData.title || feed.title,
      })
      .where(eq(rss_feeds_table.id, feed.id));
  } catch {
    // Preserve prior behavior: update failures were ignored
  }

  // Queue each new post for auto-generation
  let queued = 0;
  const videosPerPost = feed.auto_videos_per_post || 1;

  for (const post of insertedPosts) {
    try {
      const queuedCount = await queuePostForGeneration(
        database,
        post,
        videosPerPost
      );
      queued += queuedCount;

      // Mark post as converting
      try {
        await database
          .update(blog_posts_table)
          .set({ status: "converting" })
          .where(eq(blog_posts_table.id, post.id));
      } catch {
        // Preserve prior behavior: update failures were ignored
      }
    } catch (error) {
      console.error(`Error queuing post ${post.id}:`, error);
    }
  }

  return { newPosts: insertedPosts.length, queued };
}

/**
 * Queue a blog post for video generation.
 * If videosPerPost > 1, segments the content first.
 */
async function queuePostForGeneration(
  database: DbClient,
  post: BlogPost,
  videosPerPost: number
): Promise<number> {
  const queueItems: GenerationQueueItemInsert[] = [];

  if (videosPerPost === 1) {
    // Single video - queue directly without segmentation
    queueItems.push({
      blog_post_id: post.id,
      segment_id: null,
      status: "pending",
      priority: 1,
      attempts: 0,
      max_attempts: 3,
      scheduled_for: new Date().toISOString(),
    });
  } else {
    // Multiple videos - segment first
    const segmentResults = await segmentContent({
      title: post.title,
      content: post.content,
      maxSegments: videosPerPost,
      targetDurationPerSegment: 60, // Default 60 seconds per segment
    });

    // Insert segments into the database
    const segmentsToInsert: ContentSegmentInsert[] = segmentResults.map(
      (segment, index) => ({
        blog_post_id: post.id,
        segment_index: index,
        title: segment.title,
        content: segment.content,
        key_points: segment.keyPoints,
      })
    );

    let createdSegments: typeof content_segments_table.$inferSelect[];
    try {
      createdSegments = await database
        .insert(content_segments_table)
        .values(segmentsToInsert)
        .returning();
    } catch (segmentError) {
      throw new Error(
        `Failed to create segments: ${segmentError instanceof Error ? segmentError.message : "Unknown error"}`
      );
    }

    // Queue each segment for generation
    for (const segment of createdSegments) {
      queueItems.push({
        blog_post_id: post.id,
        segment_id: segment.id,
        status: "pending",
        priority: segment.segment_index + 1, // Lower index = higher priority
        attempts: 0,
        max_attempts: 3,
        scheduled_for: new Date().toISOString(),
      });
    }
  }

  // Insert queue items
  try {
    await database.insert(generation_queue_table).values(queueItems);
  } catch (queueError) {
    throw new Error(
      `Failed to queue items: ${queueError instanceof Error ? queueError.message : "Unknown error"}`
    );
  }

  return queueItems.length;
}
