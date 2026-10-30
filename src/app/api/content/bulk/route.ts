import { NextRequest, NextResponse, after } from "next/server";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, generation_queue, videos } from "@/db/schema";
import { loadQueueSettings, processQueueItemsNow, queueBlocker } from "@/lib/generation-queue";

const MAX_POSTS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acts on several Content posts at once.
 * - "create_videos" queues each post for a script and a video with the saved video defaults, and
 *   starts on them right away. Finished videos land in the Approval Queue.
 * - "ignore" moves new posts to Ignored.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { action?: unknown; postIds?: unknown } | null;
    const postIds = Array.isArray(body?.postIds)
      ? [...new Set(body.postIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))]
      : [];
    if (postIds.length === 0) {
      return NextResponse.json({ error: "Select at least one post." }, { status: 400 });
    }
    if (postIds.length > MAX_POSTS) {
      return NextResponse.json({ error: `Select up to ${MAX_POSTS} posts at a time.` }, { status: 400 });
    }

    if (body?.action === "ignore") {
      const ignored = await db
        .update(blog_posts)
        .set({ status: "ignored" })
        .where(and(inArray(blog_posts.id, postIds), eq(blog_posts.status, "new")))
        .returning({ id: blog_posts.id });
      return NextResponse.json({ ignored: ignored.length });
    }

    if (body?.action !== "create_videos") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const { defaults } = await loadQueueSettings();
    const blocker = queueBlocker(defaults);
    if (blocker) {
      return NextResponse.json({ error: blocker }, { status: 503 });
    }

    // Skip posts that are already queued or already have a video.
    const [posts, queued, withVideo] = await Promise.all([
      db.select({ id: blog_posts.id }).from(blog_posts).where(inArray(blog_posts.id, postIds)),
      db
        .select({ id: generation_queue.blog_post_id })
        .from(generation_queue)
        .where(
          and(
            inArray(generation_queue.blog_post_id, postIds),
            isNull(generation_queue.segment_id),
            inArray(generation_queue.status, ["pending", "processing"])
          )
        ),
      db
        .select({ id: videos.blog_post_id })
        .from(videos)
        .where(
          and(inArray(videos.blog_post_id, postIds), isNull(videos.content_segment_id), ne(videos.status, "failed"))
        ),
    ]);
    const busy = new Set([...queued, ...withVideo].map((row) => row.id));
    const toQueue = posts.map((post) => post.id).filter((id) => !busy.has(id));

    if (toQueue.length > 0) {
      const items = await db
        .insert(generation_queue)
        .values(toQueue.map((id) => ({ blog_post_id: id, status: "pending" as const, priority: 0 })))
        .returning({ id: generation_queue.id });
      await db.update(blog_posts).set({ status: "converting" }).where(inArray(blog_posts.id, toQueue));

      // Write the scripts after responding; the worker renders each video as it's created.
      const ids = items.map((item) => item.id);
      after(() => processQueueItemsNow(ids));
    }

    return NextResponse.json({ queued: toQueue.length, skipped: postIds.length - toQueue.length });
  } catch (error) {
    console.error("Error in bulk content action:", error);
    return NextResponse.json({ error: "Failed to update the selected posts" }, { status: 500 });
  }
}
