import { strict as assert } from "node:assert";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { blog_posts, rss_feeds, videos } from "../src/db/schema";

function assertIsoTimestamp(value: string, fieldName: string): void {
  assert.equal(typeof value, "string", `${fieldName} must be a string`);
  const dateValue = new Date(value);
  assert.equal(
    value,
    dateValue.toISOString(),
    `${fieldName} must be an ISO-8601 string`
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for scripts/db-smoke.ts");
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  // It writes and deletes rows, so only run it against a database meant for that.
  if (!/smoke|test|scratch/i.test(databaseName)) {
    throw new Error(
      `Refusing to run against "${databaseName}". Use a database whose name contains smoke, test or scratch.`
    );
  }

  const seedToken = Date.now().toString(36);
  const feedUrl = `https://smoke-${seedToken}.example.com/rss.xml`;
  const postUrl = `https://smoke-${seedToken}.example.com/posts/1`;
  const knownInstantRawUtc = "2026-10-29 16:20:28.160345+00";
  const knownInstantRawOffset = "2026-10-29 16:20:28+05:30";
  const expectedKnownUtcIso = new Date(knownInstantRawUtc).toISOString();
  const expectedKnownOffsetIso = new Date(knownInstantRawOffset).toISOString();
  const styleOptions = {
    apiVersion: "link_to_video",
    targetDuration: 45,
    aspectRatio: "9:16",
  };

  let feedId: string | null = null;
  let postId: string | null = null;
  let videoId: string | null = null;

  try {
    const [feed] = await db
      .insert(rss_feeds)
      .values({
        url: feedUrl,
        title: "Smoke Feed",
        last_checked_at: knownInstantRawUtc,
      })
      .returning();

    assert(feed, "rss_feeds insert should return a row");
    feedId = feed.id;
    assertIsoTimestamp(feed.created_at, "rss_feeds.created_at");
    assertIsoTimestamp(feed.updated_at, "rss_feeds.updated_at");
    assert.equal(
      feed.last_checked_at,
      expectedKnownUtcIso,
      "rss_feeds.last_checked_at must normalize to the expected ISO instant"
    );

    const [post] = await db
      .insert(blog_posts)
      .values({
        feed_id: feed.id,
        url: postUrl,
        title: "Smoke Post",
        content: "Smoke content",
        published_at: knownInstantRawOffset,
      })
      .returning();

    assert(post, "blog_posts insert should return a row");
    postId = post.id;
    assertIsoTimestamp(post.created_at, "blog_posts.created_at");
    assertIsoTimestamp(post.updated_at, "blog_posts.updated_at");
    assert.equal(
      post.published_at,
      expectedKnownOffsetIso,
      "blog_posts.published_at must normalize to the expected ISO instant"
    );

    const [video] = await db
      .insert(videos)
      .values({
        blog_post_id: post.id,
        script: "Smoke video script",
        style_options: styleOptions,
        duration_seconds: 45,
      })
      .returning();

    assert(video, "videos insert should return a row");
    videoId = video.id;
    assertIsoTimestamp(video.created_at, "videos.created_at");
    assertIsoTimestamp(video.updated_at, "videos.updated_at");
    assert.equal(typeof video.duration_seconds, "number");
    assert.deepEqual(video.style_options, styleOptions);

    const [selectedVideo] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, video.id))
      .limit(1);

    const [selectedFeed] = await db
      .select({
        last_checked_at: rss_feeds.last_checked_at,
      })
      .from(rss_feeds)
      .where(eq(rss_feeds.id, feed.id))
      .limit(1);

    const [selectedPost] = await db
      .select({
        published_at: blog_posts.published_at,
      })
      .from(blog_posts)
      .where(eq(blog_posts.id, post.id))
      .limit(1);

    assert(selectedVideo, "videos select should return inserted row");
    assertIsoTimestamp(selectedVideo.created_at, "videos.selected.created_at");
    assertIsoTimestamp(selectedVideo.updated_at, "videos.selected.updated_at");
    assert.equal(typeof selectedVideo.duration_seconds, "number");
    assert.deepEqual(selectedVideo.style_options, styleOptions);
    assert(selectedFeed, "rss_feeds select should return inserted row");
    assert.equal(
      selectedFeed.last_checked_at,
      expectedKnownUtcIso,
      "selected rss_feeds.last_checked_at must match expected ISO instant"
    );
    assert(selectedPost, "blog_posts select should return inserted row");
    assert.equal(
      selectedPost.published_at,
      expectedKnownOffsetIso,
      "selected blog_posts.published_at must match expected ISO instant"
    );

    console.log("db-smoke passed");
  } finally {
    if (videoId) {
      await db.delete(videos).where(eq(videos.id, videoId));
    }
    if (postId) {
      await db.delete(blog_posts).where(eq(blog_posts.id, postId));
    }
    if (feedId) {
      await db.delete(rss_feeds).where(eq(rss_feeds.id, feedId));
    }
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
