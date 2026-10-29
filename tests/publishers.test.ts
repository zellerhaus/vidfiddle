import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublisher } from "../src/lib/publishers";
import { createLightPostPublisher } from "../src/lib/publishers/lightpost";
import { createPublerPublisher } from "../src/lib/publishers/publer";

const ENV_KEYS = [
  "PUBLISHER",
  "PUBLER_API_KEY",
  "PUBLER_WORKSPACE_ID",
  "LIGHTPOST_URL",
  "LIGHTPOST_PASSWORD",
  "LIGHTPOST_ACCOUNTS",
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
