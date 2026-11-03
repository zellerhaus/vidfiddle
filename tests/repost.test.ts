import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { blog_posts, scheduled_posts, videos } from "../src/db/schema";

let dbModule: typeof import("../src/db") | null = null;

after(async () => {
  await dbModule?.closeDb();
});

const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

// A Postiz with one YouTube channel. Each create returns a new post ID.
function stubPostiz(): () => void {
  const originalFetch = globalThis.fetch;
  let created = 0;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.host === "public.example.com") {
      return new Response(VIDEO_BYTES, { headers: { "content-type": "video/mp4" } });
    }
    const path = url.pathname.replace("/public/v1", "");
    if (path === "/integrations") return jsonResponse([{ id: "yt", identifier: "youtube", name: "YT" }]);
    if (path === "/upload") return jsonResponse({ id: "m1", path: "https://uploads.postiz.local/v.mp4" });
    if (path === "/find-slot/yt") return jsonResponse({ date: new Date(Date.now() + 3_600_000).toISOString() });
    if (path === "/posts" && request.method === "POST") {
      created += 1;
      return jsonResponse([{ postId: `p-yt-${created}`, integration: "yt" }]);
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// Writes to a real database: point TEST_DATABASE_URL at a disposable one (README, "Development").
test("reposting to the platform a video already went to records each repost", {
  skip: !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run",
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.PUBLISHER = "postiz";
  process.env.POSTIZ_API_KEY = "pz-key";

  const [{ db }, { POST }] = await Promise.all([
    import("../src/db"),
    import("../src/app/api/scheduled/[id]/repost/route"),
  ]);
  dbModule = await import("../src/db");

  const blogPostId = randomUUID();
  const videoId = randomUUID();
  const originalId = randomUUID();
  const restoreFetch = stubPostiz();

  try {
    await db.insert(blog_posts).values({
      id: blogPostId,
      url: `https://example.test/repost-${blogPostId}`,
      title: "Repost test",
      content: "A post used by the repost test.",
    });
    await db.insert(videos).values({
      id: videoId,
      blog_post_id: blogPostId,
      script: "A script.",
      status: "completed",
      video_url: "https://public.example.com/video.mp4",
    });
    await db.insert(scheduled_posts).values({
      id: originalId,
      video_id: videoId,
      platform: "youtube",
      caption: "The original caption",
      status: "posted",
      published_at: new Date().toISOString(),
    });

    const repost = () =>
      POST(
        new Request(`http://localhost/api/scheduled/${originalId}/repost`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platforms: ["youtube"] }),
        }) as Parameters<typeof POST>[0],
        { params: Promise.resolve({ id: originalId }) }
      );

    for (const expectedPostId of ["p-yt-1", "p-yt-2"]) {
      const response = await repost();
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.scheduledPosts.length, 1);
      assert.equal(body.scheduledPosts[0].publer_post_id, expectedPostId);
    }

    const reposts = await db
      .select()
      .from(scheduled_posts)
      .where(and(eq(scheduled_posts.video_id, videoId), eq(scheduled_posts.is_repost, true)));
    assert.deepEqual(reposts.map((post) => post.publer_post_id).sort(), ["p-yt-1", "p-yt-2"]);
    for (const post of reposts) {
      assert.equal(post.original_post_id, originalId);
      assert.equal(post.platform, "youtube");
      assert.equal(post.caption, "The original caption");
    }

    // Originals are still one per video and platform.
    await assert.rejects(
      db.insert(scheduled_posts).values({ video_id: videoId, platform: "youtube", caption: "Again" })
    );
  } finally {
    restoreFetch();
    await db.delete(videos).where(eq(videos.id, videoId));
    await db.delete(blog_posts).where(eq(blog_posts.id, blogPostId));
  }
});
