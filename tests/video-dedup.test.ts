import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { blog_posts, generation_queue, scheduled_posts, videos } from "../src/db/schema";

// Writes to a real database: point TEST_DATABASE_URL at a disposable one (README, "Development").
const skip = !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run";

let dbModule: typeof import("../src/db") | null = null;
after(async () => {
  await dbModule?.closeDb();
});

async function setup() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OPENAI_API_KEY ||= "test-openai-key";
  dbModule = await import("../src/db");
  return dbModule.db;
}

async function createPost(db: Awaited<ReturnType<typeof setup>>) {
  const id = randomUUID();
  await db.insert(blog_posts).values({
    id,
    url: `https://example.test/dedup-${id}`,
    title: "Dedup test",
    content: "A short article used by the dedup test.",
  });
  return id;
}

function generateRequest(blogPostId: string, voice: string) {
  return new Request("http://localhost/api/videos/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blogPostId, script: "A short test script.", apiMethod: "local", accentId: voice }),
  });
}

test("generate route shares one video between duplicate requests and re-renders a finished one", { skip }, async () => {
  const db = await setup();
  const { POST } = await import("../src/app/api/videos/generate/route");
  const call = async (postId: string, voice: string) => {
    const response = await POST(generateRequest(postId, voice) as Parameters<typeof POST>[0]);
    return { status: response.status, body: await response.json() };
  };
  const blogPostId = await createPost(db);

  try {
    // A double click (or development's double effect) sends two requests at once.
    const [first, second] = await Promise.all([call(blogPostId, "nova"), call(blogPostId, "nova")]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.videoId, second.body.videoId);
    const rows = await db.select().from(videos).where(eq(videos.blog_post_id, blogPostId));
    assert.equal(rows.length, 1);
    const [post] = await db.select().from(blog_posts).where(eq(blog_posts.id, blogPostId));
    assert.equal(post.status, "converting");

    // Once it's finished, generating again renders the same row with the new settings.
    const videoId = String(first.body.videoId);
    await db
      .update(videos)
      .set({ status: "completed", video_url: "http://localhost/media/generated/x.mp4" })
      .where(eq(videos.id, videoId));
    const again = await call(blogPostId, "onyx");
    assert.equal(again.status, 200);
    assert.equal(again.body.videoId, videoId);
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    assert.equal(video.status, "pending");
    assert.equal(video.video_url, null);
    assert.equal((video.style_options as { voice?: string }).voice, "onyx");

    // A video waiting to post isn't replaced under the scheduled posts.
    await db.update(videos).set({ status: "completed" }).where(eq(videos.id, videoId));
    await db.insert(scheduled_posts).values({ video_id: videoId, platform: "tiktok", caption: "Test", status: "scheduled" });
    const blocked = await call(blogPostId, "nova");
    assert.equal(blocked.status, 409);
  } finally {
    const ids = (await db.select({ id: videos.id }).from(videos).where(eq(videos.blog_post_id, blogPostId))).map((v) => v.id);
    if (ids.length) {
      await db.delete(scheduled_posts).where(inArray(scheduled_posts.video_id, ids));
      await db.delete(videos).where(inArray(videos.id, ids));
    }
    await db.delete(blog_posts).where(eq(blog_posts.id, blogPostId));
  }
});

test("claimQueueItems hands each due item to one caller", { skip }, async () => {
  const db = await setup();
  const { claimQueueItems } = await import("../src/lib/generation-queue");
  const blogPostId = await createPost(db);

  try {
    const items = await db
      .insert(generation_queue)
      .values([
        { blog_post_id: blogPostId, status: "pending" },
        { blog_post_id: blogPostId, status: "pending", scheduled_for: new Date(Date.now() + 3_600_000).toISOString() },
      ])
      .returning({ id: generation_queue.id });
    const ids = items.map((item) => item.id);

    const [a, b] = await Promise.all([claimQueueItems(db, { ids, limit: 10 }), claimQueueItems(db, { ids, limit: 10 })]);
    // Only the due item is claimed, and only once.
    assert.equal(a.length + b.length, 1);
    const claimed = [...a, ...b][0];
    assert.equal(claimed.id, ids[0]);
    assert.equal(claimed.status, "processing");
  } finally {
    await db.delete(generation_queue).where(eq(generation_queue.blog_post_id, blogPostId));
    await db.delete(blog_posts).where(eq(blog_posts.id, blogPostId));
  }
});

test("bulk ignore only moves new posts", { skip }, async () => {
  const db = await setup();
  const { POST } = await import("../src/app/api/content/bulk/route");
  const fresh = await createPost(db);
  const converted = await createPost(db);
  await db.update(blog_posts).set({ status: "converted" }).where(eq(blog_posts.id, converted));

  try {
    const request = new Request("http://localhost/api/content/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", postIds: [fresh, converted, "not-a-uuid"] }),
    });
    const response = await POST(request as Parameters<typeof POST>[0]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ignored: 1 });
    const rows = await db.select().from(blog_posts).where(inArray(blog_posts.id, [fresh, converted]));
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.status])), { [fresh]: "ignored", [converted]: "converted" });
  } finally {
    await db.delete(blog_posts).where(inArray(blog_posts.id, [fresh, converted]));
  }
});
