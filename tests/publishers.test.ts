import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getPublisher } from "../src/lib/publishers";
import { createLightPostPublisher } from "../src/lib/publishers/lightpost";
import { createPostizPublisher } from "../src/lib/publishers/postiz";
import { createPublerPublisher } from "../src/lib/publishers/publer";
import { createTryPostPublisher } from "../src/lib/publishers/trypost";

const ENV_KEYS = [
  "PUBLISHER",
  "PUBLER_API_KEY",
  "PUBLER_WORKSPACE_ID",
  "LIGHTPOST_URL",
  "LIGHTPOST_PASSWORD",
  "LIGHTPOST_ACCOUNTS",
  "POSTIZ_API_KEY",
  "POSTIZ_URL",
  "TRYPOST_API_KEY",
  "TRYPOST_URL",
] as const;

async function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => Promise<void> | void
): Promise<void> {
  const previous = new Map<string, string | undefined>();

  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const prior = previous.get(key);
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  }
}

test("getPublisher selection precedence", async () => {
  await withEnv(
    {
      PUBLISHER: "lightpost",
      PUBLER_API_KEY: "publer-key",
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "lightpost");
    }
  );

  await withEnv(
    {
      PUBLISHER: "publer",
      PUBLER_API_KEY: "publer-key",
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "publer");
    }
  );

  await withEnv(
    {
      PUBLER_API_KEY: "publer-key",
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "publer");
    }
  );

  await withEnv(
    {
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "lightpost");
    }
  );

  await withEnv(
    {
      POSTIZ_API_KEY: "postiz-key",
      TRYPOST_API_KEY: "trypost-key",
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "postiz");
    }
  );

  await withEnv(
    {
      TRYPOST_API_KEY: "trypost-key",
      LIGHTPOST_URL: "http://lightpost.local",
    },
    () => {
      assert.equal(getPublisher()?.name, "trypost");
    }
  );

  await withEnv(
    {
      PUBLISHER: "trypost",
      PUBLER_API_KEY: "publer-key",
      TRYPOST_API_KEY: "trypost-key",
    },
    () => {
      assert.equal(getPublisher()?.name, "trypost");
    }
  );

  await withEnv(
    {
      PUBLISHER: "postiz",
      PUBLER_API_KEY: "publer-key",
    },
    () => {
      assert.equal(getPublisher(), null);
    }
  );

  await withEnv({}, () => {
    assert.equal(getPublisher(), null);
  });
});

test("LightPost login, cookie reuse, and re-login on 401", async () => {
  const originalFetch = globalThis.fetch;
  let loginCount = 0;
  let stateCount = 0;
  const seenCookies: string[] = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/api/login") {
      loginCount += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": `lightpost_session=session-${loginCount}; Path=/; HttpOnly`,
        },
      });
    }

    if (url.pathname === "/api/state") {
      stateCount += 1;
      const cookie = request.headers.get("cookie") || "";
      seenCookies.push(cookie);

      if (stateCount === 3) {
        return new Response(JSON.stringify({ error: "Sign in" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          accounts: [{ id: "acc-inst", platform: "instagram", name: "IG" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    throw new Error(`Unexpected LightPost request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
        LIGHTPOST_PASSWORD: "secret",
      },
      async () => {
        const publisher = createLightPostPublisher();

        await publisher.getAccounts();
        await publisher.getAccounts();
        await publisher.getAccounts();

        assert.equal(loginCount, 2);
        assert.equal(stateCount, 4);
        assert.deepEqual(seenCookies, [
          "lightpost_session=session-1",
          "lightpost_session=session-1",
          "lightpost_session=session-1",
          "lightpost_session=session-2",
        ]);
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LightPost media import and post body for scheduled and now", async () => {
  const originalFetch = globalThis.fetch;
  const mediaBodies: Array<{ url?: string }> = [];
  const postBodies: Array<Record<string, unknown>> = [];
  let nextPost = 1;

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
      return new Response(
        JSON.stringify({
          accounts: [{ id: "ig-1", platform: "instagram", name: "IG 1" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/api/media/url") {
      mediaBodies.push((await request.json()) as { url?: string });
      return new Response(JSON.stringify({ id: "media-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/posts") {
      postBodies.push((await request.json()) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: `post-${nextPost++}` }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected LightPost request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
      },
      async () => {
        const publisher = createLightPostPublisher();

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video-1.mp4",
          accounts: [
            {
              accountId: "ig-1",
              platform: "instagram",
              caption: "Scheduled caption",
              scheduledAt: "2027-01-15T12:00:00.000Z",
            },
          ],
          autoSchedule: false,
        });

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video-2.mp4",
          accounts: [
            {
              accountId: "ig-1",
              platform: "instagram",
              caption: "Post now caption",
            },
          ],
          autoSchedule: false,
        });
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(mediaBodies.length, 2);
  assert.equal(mediaBodies[0]?.url, "https://public.example.com/video-1.mp4");
  assert.equal(mediaBodies[1]?.url, "https://public.example.com/video-2.mp4");

  assert.equal(postBodies.length, 2);
  assert.equal(postBodies[0]?.status, "scheduled");
  assert.equal(postBodies[0]?.scheduledAt, "2027-01-15T12:00:00.000Z");
  assert.deepEqual(postBodies[0]?.accountIds, ["ig-1"]);
  assert.deepEqual(postBodies[0]?.mediaIds, ["media-1"]);

  assert.equal(postBodies[1]?.status, "now");
  assert.equal(postBodies[1]?.scheduledAt, undefined);
  assert.deepEqual(postBodies[1]?.accountIds, ["ig-1"]);
  assert.deepEqual(postBodies[1]?.mediaIds, ["media-1"]);
});

test("LightPost account mapping with and without LIGHTPOST_ACCOUNTS", async () => {
  const originalFetch = globalThis.fetch;

  const withoutOverrideBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
      return new Response(
        JSON.stringify({
          accounts: [
            { id: "ig-1", platform: "instagram", name: "IG 1" },
            { id: "ig-2", platform: "instagram", name: "IG 2" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/api/media/url") {
      return new Response(JSON.stringify({ id: "media-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/posts") {
      withoutOverrideBodies.push((await request.json()) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: `post-${withoutOverrideBodies.length}` }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected LightPost request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
      },
      async () => {
        const publisher = createLightPostPublisher();

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [
            {
              platform: "instagram",
              caption: "Post to all IG accounts",
            },
          ],
          autoSchedule: false,
        });
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(withoutOverrideBodies.length, 2);
  assert.deepEqual(withoutOverrideBodies[0]?.accountIds, ["ig-1"]);
  assert.deepEqual(withoutOverrideBodies[1]?.accountIds, ["ig-2"]);

  const withOverrideBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
      return new Response(
        JSON.stringify({
          accounts: [
            { id: "ig-1", platform: "instagram", name: "IG 1" },
            { id: "ig-2", platform: "instagram", name: "IG 2" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/api/media/url") {
      return new Response(JSON.stringify({ id: "media-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/posts") {
      withOverrideBodies.push((await request.json()) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "post-override" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected LightPost request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
        LIGHTPOST_ACCOUNTS: "instagram=ig-2",
      },
      async () => {
        const publisher = createLightPostPublisher();

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [
            {
              platform: "instagram",
              caption: "Post to selected IG account",
            },
          ],
          autoSchedule: false,
        });
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(withOverrideBodies.length, 1);
  assert.deepEqual(withOverrideBodies[0]?.accountIds, ["ig-2"]);
});

test("LightPost unsupported platform error", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called for unsupported platforms");
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
      },
      async () => {
        const publisher = createLightPostPublisher();

        await assert.rejects(
          publisher.scheduleVideoPost({
            videoUrl: "https://public.example.com/video.mp4",
            accounts: [
              {
                platform: "tiktok",
                caption: "TikTok caption",
              },
            ],
            autoSchedule: false,
          }),
          /LightPost can't post video to TikTok yet/i
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("LightPost status mapping for published, failed, and pending destinations", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/api/posts") {
      return new Response(
        JSON.stringify({
          posts: [
            {
              id: "post-published",
              status: "published",
              finishedAt: "2026-10-29T10:00:00.000Z",
              accountIds: ["a-1"],
              results: [
                {
                  accountId: "a-1",
                  status: "published",
                  url: "https://social.example.com/post/123",
                  remoteId: "remote-123",
                },
              ],
            },
            {
              id: "post-failed",
              status: "failed",
              accountIds: ["a-2"],
              results: [
                {
                  accountId: "a-2",
                  status: "failed",
                  message: "Rate limited",
                },
              ],
            },
            {
              id: "post-pending",
              status: "processing",
              scheduledAt: "2026-10-30T10:00:00.000Z",
              accountIds: ["a-3"],
              results: [
                {
                  accountId: "a-3",
                  status: "processing",
                },
              ],
            },
          ],
          total: 3,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected LightPost request: ${request.method} ${request.url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        LIGHTPOST_URL: "http://lightpost.local",
      },
      async () => {
        const publisher = createLightPostPublisher();

        const posted = await publisher.getPost("post-published");
        const failed = await publisher.getPost("post-failed");
        const pending = await publisher.getPost("post-pending");

        assert.equal(posted?.state, "published");
        assert.equal(posted?.post_link, "https://social.example.com/post/123");
        assert.equal(posted?.remote_post_id, "remote-123");

        assert.equal(failed?.state, "failed");
        assert.equal(failed?.error, "Rate limited");

        assert.equal(pending?.state, "scheduled");
        assert.equal(pending?.scheduled_at, "2026-10-30T10:00:00.000Z");
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Publer adapter delegates with the same API request sequence", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;
    const method = request.method;
    const body = method === "POST" ? await request.text() : undefined;

    calls.push({ method, url, body });

    if (url.endsWith("/media/from-url")) {
      return new Response(JSON.stringify({ job_id: "upload-job" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/job_status/upload-job")) {
      return new Response(JSON.stringify({ id: "media-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/posts/schedule")) {
      return new Response(JSON.stringify({ job_id: "schedule-job" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/job_status/schedule-job")) {
      return new Response(
        JSON.stringify([{ id: "publer-post-1", account_id: "acc-1" }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    throw new Error(`Unexpected Publer request: ${method} ${url}`);
  }) as typeof fetch;

  try {
    await withEnv(
      {
        PUBLER_API_KEY: "publer-key",
        PUBLER_WORKSPACE_ID: "workspace-1",
      },
      async () => {
        const publisher = createPublerPublisher();

        const scheduled = await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [
            {
              accountId: "acc-1",
              platform: "instagram",
              caption: "Caption",
            },
          ],
          autoSchedule: true,
        });

        assert.equal(scheduled.jobId, "schedule-job");

        const posts = await publisher.waitForScheduleJob(scheduled.jobId);
        assert.deepEqual(posts, [
          {
            accountId: "acc-1",
            publisherPostId: "publer-post-1",
          },
        ]);
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    [
      "POST /api/v1/media/from-url",
      "GET /api/v1/job_status/upload-job",
      "POST /api/v1/posts/schedule",
      "GET /api/v1/job_status/schedule-job",
    ]
  );
});

type FetchHandler = (request: Request, url: URL) => Promise<Response> | Response;

async function withFetch(handler: FetchHandler, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request, new URL(request.url));
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const HOUR_MS = 60 * 60 * 1000;
const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

async function postizUpload(request: Request): Promise<{ name: string; size: number }> {
  assert.match(request.headers.get("content-type") ?? "", /^multipart\/form-data/);
  const file = (await request.formData()).get("file");
  assert.ok(file instanceof File);
  return { name: file.name, size: file.size };
}

interface PostizCreateBody {
  type: string;
  date: string;
  shortLink: boolean;
  posts: Array<{
    integration: { id: string };
    value: Array<{ content: string; image: Array<{ id: string; path: string }> }>;
    settings: Record<string, unknown>;
  }>;
}

interface TryPostCreateBody {
  content: string;
  media: Array<{ url?: string; id?: string }>;
  social_account_id: string;
  content_type: string;
  meta?: Record<string, unknown>;
  status: string;
  scheduled_at?: string;
  queue?: string;
}

test("Postiz lists enabled channels on platforms Vidfiddle posts to", async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];

  await withFetch(
    (request, url) => {
      seen.push({ url: url.toString(), auth: request.headers.get("authorization") });
      if (url.pathname.endsWith("/public/v1/integrations")) {
        return jsonResponse([
          { id: "ig", identifier: "instagram-standalone", name: "IG", profile: "ig_handle", picture: "https://cdn/ig.png" },
          { id: "yt", identifier: "youtube", name: "YT" },
          { id: "th", identifier: "threads", name: "Threads" },
          { id: "x-off", identifier: "x", name: "X", disabled: true },
        ]);
      }
      throw new Error(`Unexpected Postiz request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key", POSTIZ_URL: "https://postiz.local/api/" }, async () => {
        const accounts = await createPostizPublisher().getAccounts();
        assert.deepEqual(accounts, [
          { id: "ig", name: "IG", platform: "instagram", avatar_url: "https://cdn/ig.png", username: "ig_handle" },
          { id: "yt", name: "YT", platform: "youtube", avatar_url: undefined, username: undefined },
        ]);
      });

      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        await createPostizPublisher().getAccounts();
      });
    }
  );

  assert.equal(seen[0]?.url, "https://postiz.local/api/public/v1/integrations");
  assert.equal(seen[0]?.auth, "pz-key");
  // Without POSTIZ_URL it talks to Postiz Cloud.
  assert.equal(seen[1]?.url, "https://api.postiz.com/public/v1/integrations");
});

test("Postiz uploads the video once and schedules every channel in one request", async () => {
  const slot = new Date(Date.now() + 3 * HOUR_MS).toISOString();
  const uploads: Array<{ name: string; size: number }> = [];
  const creates: PostizCreateBody[] = [];

  await withFetch(
    async (request, url) => {
      if (url.host === "public.example.com") {
        return new Response(VIDEO_BYTES, { headers: { "content-type": "video/mp4" } });
      }
      const path = url.pathname.replace("/public/v1", "");
      if (path === "/integrations") {
        return jsonResponse([
          { id: "ig", identifier: "instagram", name: "IG" },
          { id: "yt", identifier: "youtube", name: "YT" },
          { id: "tt", identifier: "tiktok", name: "TT" },
        ]);
      }
      if (path === "/upload") {
        uploads.push(await postizUpload(request));
        return jsonResponse({ id: "m1", path: "https://uploads.postiz.local/v.mp4" });
      }
      if (path === "/find-slot/ig") {
        return jsonResponse({ date: slot });
      }
      if (path === "/posts" && request.method === "POST") {
        creates.push(await request.json());
        return jsonResponse([
          { postId: "p-ig", integration: "ig" },
          { postId: "p-yt", integration: "yt" },
          { postId: "p-tt", integration: "tt" },
        ]);
      }
      throw new Error(`Unexpected Postiz request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        const publisher = createPostizPublisher();
        const { jobId, mediaId } = await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [
            { accountId: "ig", platform: "instagram", caption: "Line one & <two>\nLine 2" },
            { accountId: "yt", platform: "youtube", caption: "Caption", title: "My <Blog> Post" },
            { accountId: "tt", platform: "tiktok", caption: "TikTok caption" },
          ],
          autoSchedule: true,
        });

        assert.equal(mediaId, "m1");
        assert.deepEqual(await publisher.waitForScheduleJob(jobId), [
          { accountId: "ig", publisherPostId: "p-ig" },
          { accountId: "yt", publisherPostId: "p-yt" },
          { accountId: "tt", publisherPostId: "p-tt" },
        ]);
      });
    }
  );

  assert.deepEqual(uploads, [{ name: "video.mp4", size: VIDEO_BYTES.length }]);
  assert.equal(creates.length, 1);

  const body = creates[0]!;
  assert.equal(body.type, "schedule");
  assert.equal(body.date, slot);
  assert.equal(body.shortLink, false);
  assert.deepEqual(
    body.posts.map((post) => post.integration.id),
    ["ig", "yt", "tt"]
  );

  const [ig, yt, tt] = body.posts;
  // Postiz reads text as HTML: escaped paragraphs come out as plain lines.
  assert.equal(ig.value[0].content, "<p>Line one &amp; &lt;two&gt;</p><p>Line 2</p>");
  assert.deepEqual(ig.value[0].image, [{ id: "m1", path: "https://uploads.postiz.local/v.mp4" }]);
  assert.equal(ig.settings.__type, "instagram");
  assert.equal(ig.settings.post_type, "post");
  assert.equal(yt.settings.title, "My Blog Post");
  assert.equal(yt.settings.type, "public");
  assert.equal(tt.settings.privacy_level, "PUBLIC_TO_EVERYONE");
  assert.equal(tt.settings.content_posting_method, "DIRECT_POST");
});

test("Postiz gets a locally stored video from disk, not from PUBLIC_URL", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vf-postiz-"));
  await mkdir(path.join(dataDir, "media", "generated"), { recursive: true });
  await writeFile(path.join(dataDir, "media", "generated", "abc.mp4"), VIDEO_BYTES);
  const saved = { DATA_DIR: process.env.DATA_DIR, PUBLIC_URL: process.env.PUBLIC_URL };
  process.env.DATA_DIR = dataDir;
  process.env.PUBLIC_URL = "http://192.168.1.20:3000";
  const uploads: Array<{ name: string; size: number }> = [];

  try {
    await withFetch(
      async (request, url) => {
        const path = url.pathname.replace("/public/v1", "");
        if (path === "/integrations") return jsonResponse([{ id: "yt", identifier: "youtube", name: "YT" }]);
        if (path === "/upload") {
          uploads.push(await postizUpload(request));
          return jsonResponse({ id: "m1", path: "https://uploads.postiz.local/v.mp4" });
        }
        if (path === "/posts" && request.method === "POST") return jsonResponse([{ postId: "p1", integration: "yt" }]);
        throw new Error(`Unexpected request: ${request.method} ${url}`);
      },
      async () => {
        await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
          await createPostizPublisher().scheduleVideoPost({
            videoUrl: "http://192.168.1.20:3000/media/generated/abc.mp4",
            accounts: [{ accountId: "yt", platform: "youtube", caption: "Hi" }],
            autoSchedule: false,
          });
        });
      }
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  }

  assert.deepEqual(uploads, [{ name: "abc.mp4", size: VIDEO_BYTES.length }]);
});

test("Postiz posts now, keeps set times, and picks a time itself when find-slot fails", async () => {
  const creates: PostizCreateBody[] = [];
  const later = "2027-03-01T15:00:00.000Z";
  const evenLater = "2027-03-02T15:00:00.000Z";

  await withFetch(
    async (request, url) => {
      if (url.host === "public.example.com") {
        return new Response(VIDEO_BYTES, { headers: { "content-type": "video/mp4" } });
      }
      const path = url.pathname.replace("/public/v1", "");
      if (path === "/integrations") {
        return jsonResponse([
          { id: "ig", identifier: "instagram", name: "IG" },
          { id: "li", identifier: "linkedin-page", name: "LI" },
        ]);
      }
      if (path === "/upload") {
        return jsonResponse({ id: "m1", path: "https://uploads.postiz.local/v.mp4" });
      }
      if (path.startsWith("/find-slot/")) {
        return jsonResponse({ msg: "boom" }, 500);
      }
      if (path === "/posts" && request.method === "POST") {
        const body = (await request.json()) as PostizCreateBody;
        creates.push(body);
        return jsonResponse(
          body.posts.map((post, i) => ({ postId: `p${creates.length}-${i}`, integration: post.integration.id }))
        );
      }
      throw new Error(`Unexpected Postiz request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        const publisher = createPostizPublisher();

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/now.mp4",
          accounts: [{ accountId: "ig", platform: "instagram", caption: "Now" }],
          autoSchedule: false,
        });

        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/set.mp4",
          accounts: [
            { accountId: "ig", platform: "instagram", caption: "A", scheduledAt: later },
            { accountId: "li", platform: "linkedin", caption: "B", scheduledAt: evenLater },
          ],
          autoSchedule: false,
        });

        const before = Date.now();
        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/auto.mp4",
          accounts: [{ accountId: "li", platform: "linkedin", caption: "Auto" }],
          autoSchedule: true,
        });
        const autoDate = new Date(creates[3]!.date).getTime();
        assert.ok(autoDate > before && autoDate < before + HOUR_MS, "fallback time is a few minutes out");
      });
    }
  );

  assert.equal(creates.length, 4);
  assert.equal(creates[0]!.type, "now");
  // One date per Postiz request, so different set times become separate requests.
  assert.deepEqual(
    creates.slice(1, 3).map((body) => [body.type, body.date, body.posts[0].integration.id]),
    [
      ["schedule", later, "ig"],
      ["schedule", evenLater, "li"],
    ]
  );
  assert.equal(creates[2]!.posts[0].settings.__type, "linkedin-page");
});

test("Postiz refuses a channel it doesn't have before uploading anything", async () => {
  let uploads = 0;

  await withFetch(
    (request, url) => {
      if (url.pathname.endsWith("/integrations")) {
        return jsonResponse([{ id: "ig", identifier: "instagram", name: "IG" }]);
      }
      uploads += 1;
      return jsonResponse({});
    },
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        await assert.rejects(
          createPostizPublisher().scheduleVideoPost({
            videoUrl: "https://public.example.com/video.mp4",
            accounts: [{ accountId: "gone", platform: "tiktok", caption: "x" }],
            autoSchedule: true,
          }),
          /Postiz has no channel gone/
        );
      });
    }
  );

  assert.equal(uploads, 0);
});

test("Postiz post status: states, one listing per pass, and errors don't read as missing", async () => {
  let listings = 0;
  let query: URLSearchParams | null = null;

  await withFetch(
    (request, url) => {
      if (url.pathname.endsWith("/public/v1/posts") && request.method === "GET") {
        listings += 1;
        query = url.searchParams;
        return jsonResponse({
          posts: [
            {
              id: "p-pub",
              state: "PUBLISHED",
              publishDate: "2026-10-29T10:00:00.000Z",
              releaseURL: "https://www.tiktok.com/@me/video/1",
              releaseId: "remote-1",
            },
            { id: "p-err", state: "ERROR", publishDate: "2026-10-29T11:00:00.000Z", error: "Account banned" },
            { id: "p-queue", state: "QUEUE", publishDate: "2026-11-05T09:00:00.000Z" },
          ],
        });
      }
      throw new Error(`Unexpected Postiz request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        const publisher = createPostizPublisher();

        assert.deepEqual(await publisher.getPost("p-pub"), {
          id: "p-pub",
          state: "published",
          published_at: "2026-10-29T10:00:00.000Z",
          post_link: "https://www.tiktok.com/@me/video/1",
          remote_post_id: "remote-1",
        });
        assert.equal((await publisher.getPost("p-err"))?.state, "failed");
        assert.equal((await publisher.getPost("p-err"))?.error, "Account banned");
        assert.equal((await publisher.getPost("p-queue"))?.state, "scheduled");
        assert.equal(await publisher.getPost("p-missing"), null);
      });
    }
  );

  assert.equal(listings, 1);
  assert.ok(query!.get("startDate") && query!.get("endDate"));

  await withFetch(
    () => jsonResponse({ message: "Internal server error" }, 500),
    async () => {
      await withEnv({ POSTIZ_API_KEY: "pz-key" }, async () => {
        await assert.rejects(createPostizPublisher().getPost("p-pub"), /Internal server error/);
      });
    }
  );
});

test("TryPost lists connected channels across pages", async () => {
  const seen: Array<{ url: string; auth: string | null; accept: string | null }> = [];

  await withFetch(
    (request, url) => {
      seen.push({ url: url.toString(), auth: request.headers.get("authorization"), accept: request.headers.get("accept") });
      if (url.pathname === "/api/social-accounts") {
        return url.searchParams.get("page") === "1"
          ? jsonResponse({
              data: [
                { id: "ig", platform: "instagram-facebook", display_name: "IG", username: "ig_handle", status: "connected" },
                { id: "x", platform: "x", display_name: "X", status: "token_expired" },
              ],
              meta: { current_page: 1, last_page: 2 },
            })
          : jsonResponse({
              data: [
                { id: "yt", platform: "youtube", display_name: "YT", status: "connected" },
                { id: "pin", platform: "pinterest", display_name: "Pins", status: "connected" },
              ],
              meta: { current_page: 2, last_page: 2 },
            });
      }
      throw new Error(`Unexpected TryPost request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key", TRYPOST_URL: "https://trypost.local/" }, async () => {
        assert.deepEqual(await createTryPostPublisher().getAccounts(), [
          { id: "ig", name: "IG", platform: "instagram", username: "ig_handle" },
          { id: "yt", name: "YT", platform: "youtube", username: undefined },
        ]);
      });
    }
  );

  assert.deepEqual(
    seen.map((call) => call.url),
    ["https://trypost.local/api/social-accounts?page=1", "https://trypost.local/api/social-accounts?page=2"]
  );
  assert.equal(seen[0]?.auth, "Bearer tp-key");
  assert.equal(seen[0]?.accept, "application/json");
});

const TRYPOST_ACCOUNTS = {
  data: [
    { id: "ig", platform: "instagram", display_name: "IG", status: "connected", has_posting_schedule: true },
    { id: "tt", platform: "tiktok", display_name: "TT", status: "connected", has_posting_schedule: false },
    { id: "yt", platform: "youtube", display_name: "YT", status: "connected", has_posting_schedule: false },
  ],
  meta: { current_page: 1, last_page: 1 },
};

test("TryPost creates one post per channel and downloads the video once", async () => {
  const creates: TryPostCreateBody[] = [];

  await withFetch(
    async (request, url) => {
      if (url.pathname === "/api/social-accounts") {
        return jsonResponse(TRYPOST_ACCOUNTS);
      }
      if (url.pathname === "/api/social-accounts/tt/tiktok-creator-info") {
        return jsonResponse({ can_post: true, privacy_level_options: ["FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"] });
      }
      if (url.pathname === "/api/posts" && request.method === "POST") {
        creates.push(await request.json());
        return jsonResponse({ id: `post-${creates.length}`, status: "scheduled", media: [{ id: "media-1" }] }, 201);
      }
      throw new Error(`Unexpected TryPost request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key" }, async () => {
        const publisher = createTryPostPublisher();
        const before = Date.now();
        const { jobId, mediaId } = await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [
            { accountId: "ig", platform: "instagram", caption: "IG caption" },
            { accountId: "tt", platform: "tiktok", caption: "TT caption" },
            { accountId: "yt", platform: "youtube", caption: "First line\nMore", title: "Blog title" },
          ],
          autoSchedule: true,
        });

        assert.equal(mediaId, "media-1");
        assert.deepEqual(await publisher.waitForScheduleJob(jobId), [
          { accountId: "ig", publisherPostId: "post-1" },
          { accountId: "tt", publisherPostId: "post-2" },
          { accountId: "yt", publisherPostId: "post-3" },
        ]);

        const tiktokAt = new Date(creates[1]!.scheduled_at ?? 0).getTime();
        assert.ok(tiktokAt > before && tiktokAt < before + HOUR_MS);
      });
    }
  );

  assert.equal(creates.length, 3);
  const [ig, tt, yt] = creates;

  assert.deepEqual(ig!.media, [{ url: "https://public.example.com/video.mp4" }]);
  assert.equal(ig!.social_account_id, "ig");
  assert.equal(ig!.content, "IG caption");
  assert.equal(ig!.content_type, "instagram_feed");
  // A channel with posting times takes its next free slot.
  assert.equal(ig!.status, "scheduled");
  assert.equal(ig!.queue, "next");
  assert.equal(ig!.meta, undefined);

  assert.deepEqual(tt!.media, [{ id: "media-1" }]);
  assert.equal(tt!.content_type, "tiktok_video");
  assert.deepEqual(tt!.meta, { privacy_level: "PUBLIC_TO_EVERYONE" });
  assert.equal(tt!.queue, undefined);

  assert.equal(yt!.content_type, "youtube_short");
  assert.deepEqual(yt!.meta, { title: "Blog title", privacy_status: "public" });
});

test("TryPost posts now or at a set time", async () => {
  const creates: TryPostCreateBody[] = [];

  await withFetch(
    async (request, url) => {
      if (url.pathname === "/api/social-accounts") {
        return jsonResponse(TRYPOST_ACCOUNTS);
      }
      if (url.pathname === "/api/posts" && request.method === "POST") {
        creates.push(await request.json());
        return jsonResponse({ id: `post-${creates.length}`, status: "scheduled", media: [{ id: "media-1" }] }, 201);
      }
      throw new Error(`Unexpected TryPost request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key" }, async () => {
        const publisher = createTryPostPublisher();
        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/now.mp4",
          accounts: [{ accountId: "ig", platform: "instagram", caption: "Now" }],
          autoSchedule: false,
        });
        await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/set.mp4",
          accounts: [{ accountId: "ig", platform: "instagram", caption: "Set", scheduledAt: "2027-01-15T12:00:00Z" }],
          autoSchedule: false,
        });
      });
    }
  );

  assert.equal(creates[0]!.status, "publishing");
  assert.equal(creates[0]!.scheduled_at, undefined);
  assert.equal(creates[0]!.queue, undefined);
  assert.equal(creates[1]!.status, "scheduled");
  assert.equal(creates[1]!.scheduled_at, "2027-01-15T12:00:00.000Z");
});

test("TryPost doesn't start posting when TikTok won't take the post", async () => {
  let creates = 0;

  await withFetch(
    (request, url) => {
      if (url.pathname === "/api/social-accounts") {
        return jsonResponse(TRYPOST_ACCOUNTS);
      }
      if (url.pathname.endsWith("/tiktok-creator-info")) {
        return jsonResponse({ can_post: false, privacy_level_options: [] });
      }
      creates += 1;
      return jsonResponse({ id: "post-x", status: "scheduled" }, 201);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key" }, async () => {
        await assert.rejects(
          createTryPostPublisher().scheduleVideoPost({
            videoUrl: "https://public.example.com/video.mp4",
            accounts: [
              { accountId: "ig", platform: "instagram", caption: "IG" },
              { accountId: "tt", platform: "tiktok", caption: "TT" },
            ],
            autoSchedule: true,
          }),
          /TikTok won't let TT post right now/
        );
      });
    }
  );

  assert.equal(creates, 0);
});

test("TryPost retries a post when the channel queue is busy", async () => {
  let attempts = 0;

  await withFetch(
    (request, url) => {
      if (url.pathname === "/api/social-accounts") {
        return jsonResponse(TRYPOST_ACCOUNTS);
      }
      if (url.pathname === "/api/posts" && request.method === "POST") {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ message: "Another change is in progress." }, 409)
          : jsonResponse({ id: "post-1", status: "scheduled", media: [] }, 201);
      }
      throw new Error(`Unexpected TryPost request: ${request.method} ${url}`);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key" }, async () => {
        const publisher = createTryPostPublisher();
        const { jobId } = await publisher.scheduleVideoPost({
          videoUrl: "https://public.example.com/video.mp4",
          accounts: [{ accountId: "ig", platform: "instagram", caption: "IG" }],
          autoSchedule: true,
        });
        assert.deepEqual(await publisher.waitForScheduleJob(jobId), [{ accountId: "ig", publisherPostId: "post-1" }]);
      });
    }
  );

  assert.equal(attempts, 2);
});

test("TryPost post status: states, null on 404, and errors don't read as missing", async () => {
  await withFetch(
    (request, url) => {
      const posts: Record<string, unknown> = {
        "/api/posts/p-pub": {
          id: "p-pub",
          status: "published",
          publish_status: "published",
          published_at: "2026-10-29 10:00:00",
          platform_url: "https://www.instagram.com/reel/abc",
        },
        "/api/posts/p-fail": { id: "p-fail", status: "failed", publish_status: "failed", error_message: "Video too long" },
        "/api/posts/p-retry": { id: "p-retry", status: "publishing", publish_status: "retrying", scheduled_at: "2026-11-05 09:00:00" },
      };
      if (posts[url.pathname]) {
        return jsonResponse(posts[url.pathname]);
      }
      if (url.pathname === "/api/posts/p-boom") {
        return jsonResponse({ message: "Server Error" }, 500);
      }
      return jsonResponse({ message: "Not found." }, 404);
    },
    async () => {
      await withEnv({ TRYPOST_API_KEY: "tp-key" }, async () => {
        const publisher = createTryPostPublisher();

        assert.deepEqual(await publisher.getPost("p-pub"), {
          id: "p-pub",
          state: "published",
          published_at: "2026-10-29T10:00:00.000Z",
          post_link: "https://www.instagram.com/reel/abc",
        });
        assert.equal((await publisher.getPost("p-fail"))?.error, "Video too long");
        assert.deepEqual(await publisher.getPost("p-retry"), {
          id: "p-retry",
          state: "scheduled",
          scheduled_at: "2026-11-05T09:00:00.000Z",
        });
        assert.equal(await publisher.getPost("p-gone"), null);
        await assert.rejects(publisher.getPost("p-boom"), /Server Error/);
      });
    }
  );
});
