import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { blog_posts, videos } from "../src/db/schema";
import {
  isLocalEngineOptions,
  toAspectRatio,
  toOpenAIVoice,
} from "../src/lib/local-engine";

let dbModule: typeof import("../src/db") | null = null;

after(async () => {
  await dbModule?.closeDb();
});

test("toAspectRatio accepts app and engine spellings", () => {
  assert.equal(toAspectRatio(undefined), "9x16");
  assert.equal(toAspectRatio("9:16"), "9x16");
  assert.equal(toAspectRatio("16:9"), "16x9");
  assert.equal(toAspectRatio("1x1"), "1x1");
  assert.equal(toAspectRatio("4:5"), "9x16");
});

test("isLocalEngineOptions identifies local style options", () => {
  assert.equal(isLocalEngineOptions({ apiVersion: "local" }), true);
  assert.equal(isLocalEngineOptions({ apiVersion: "ai_shorts" }), false);
  assert.equal(isLocalEngineOptions(null), false);
  assert.equal(isLocalEngineOptions("local"), false);
});

test("toOpenAIVoice only accepts OpenAI voices", () => {
  assert.equal(toOpenAIVoice("nova"), "nova");
  assert.equal(toOpenAIVoice("not-a-local-voice"), undefined);
  assert.equal(toOpenAIVoice(null), undefined);
});

// Writes to a real database: point TEST_DATABASE_URL at a disposable one (README, "Development").
test("generate route local branch inserts a pending local video", {
  skip: !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run",
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OPENAI_API_KEY ||= "test-openai-key";

  const [{ db }, { POST }] = await Promise.all([
    import("../src/db"),
    import("../src/app/api/videos/generate/route"),
  ]);
  dbModule = await import("../src/db");

  const blogPostId = randomUUID();
  let videoId: string | undefined;

  try {
    await db.insert(blog_posts).values({
      id: blogPostId,
      url: `https://example.test/local-engine-${blogPostId}`,
      title: "Local engine app test",
      content: "A short article used by the local engine app test.",
    });

    const request = new Request("http://localhost/api/videos/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blogPostId,
        script: "This is a local engine test script.",
        apiMethod: "local",
        aspectRatio: "16:9",
        accentId: "nova",
        visualStyle: "flat paper-cut illustration, warm colors",
      }),
    });

    const response = await POST(request as Parameters<typeof POST>[0]);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "pending");
    assert.ok(body.videoId);
    const insertedVideoId = String(body.videoId);
    videoId = insertedVideoId;

    const [video] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, insertedVideoId))
      .limit(1);

    assert.ok(video);
    assert.equal(video.status, "pending");
    assert.equal(video.creatify_job_id, null);
    assert.deepEqual(video.style_options, {
      apiVersion: "local",
      aspectRatio: "16x9",
      voice: "nova",
      visualStyle: "flat paper-cut illustration, warm colors",
    });
  } finally {
    if (videoId) {
      await db.delete(videos).where(eq(videos.id, videoId));
    }
    await db.delete(blog_posts).where(eq(blog_posts.id, blogPostId));
  }
});
