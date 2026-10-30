import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { youtube_sources } from "../src/db/schema";
import {
  submagicWebhookToken,
  verifySubmagicWebhookToken,
} from "../src/lib/submagic";

let dbModule: typeof import("../src/db") | null = null;

after(async () => {
  await dbModule?.closeDb();
});

test("Submagic webhook tokens are tied to one video", () => {
  process.env.CRON_SECRET = "test-cron-secret";
  const token = submagicWebhookToken("dQw4w9WgXcQ");
  assert.ok(token);
  assert.ok(verifySubmagicWebhookToken("dQw4w9WgXcQ", token));
  assert.ok(!verifySubmagicWebhookToken("aaaaaaaaaaa", token));
  assert.ok(!verifySubmagicWebhookToken("dQw4w9WgXcQ", token.slice(1)));
  assert.ok(!verifySubmagicWebhookToken("dQw4w9WgXcQ", null));
});

test("Submagic webhook tokens change with CRON_SECRET and need one", () => {
  process.env.CRON_SECRET = "first-secret";
  const first = submagicWebhookToken("dQw4w9WgXcQ");
  process.env.CRON_SECRET = "second-secret";
  assert.ok(!verifySubmagicWebhookToken("dQw4w9WgXcQ", first));

  delete process.env.CRON_SECRET;
  assert.equal(submagicWebhookToken("dQw4w9WgXcQ"), null);
  assert.ok(!verifySubmagicWebhookToken("dQw4w9WgXcQ", first));
});

// Writes to a real database: point TEST_DATABASE_URL at a disposable one (CONTRIBUTING.md).
test("Submagic webhook ignores calls without the source's token", {
  skip: !process.env.TEST_DATABASE_URL && "set TEST_DATABASE_URL to run",
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.CRON_SECRET = "test-cron-secret";

  const [{ db }, { POST }] = await Promise.all([
    import("../src/db"),
    import("../src/app/api/webhooks/submagic/route"),
  ]);
  dbModule = await import("../src/db");

  const sourceId = randomUUID();
  const projectId = `test-project-${sourceId}`;
  const videoId = `vid-${sourceId.slice(0, 8)}`;

  const call = (token?: string | null) =>
    POST(
      new NextRequest(
        `http://localhost/api/webhooks/submagic${token ? `?token=${token}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, status: "failed" }),
        }
      )
    );
  const status = async () => {
    const [row] = await db
      .select({ status: youtube_sources.status })
      .from(youtube_sources)
      .where(eq(youtube_sources.id, sourceId));
    return row?.status;
  };

  try {
    await db.insert(youtube_sources).values({
      id: sourceId,
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
      youtube_video_id: videoId,
      status: "submagic_processing",
      submagic_project_id: projectId,
    });

    assert.equal((await call()).status, 401);
    assert.equal((await call(submagicWebhookToken("another-video"))).status, 401);
    assert.equal(await status(), "submagic_processing");

    const accepted = await call(submagicWebhookToken(videoId));
    assert.equal(accepted.status, 200);
    assert.equal(await status(), "failed");
  } finally {
    await db.delete(youtube_sources).where(eq(youtube_sources.id, sourceId));
  }
});
