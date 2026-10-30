import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GET as mediaGet } from "../src/app/media/[...key]/route";
import {
  deleteFile,
  keyFromUrl,
  localPath,
  publicUrl,
  saveFile,
} from "../src/lib/storage";

const STORAGE_ENV_KEYS = [
  "STORAGE_DRIVER",
  "DATA_DIR",
  "PUBLIC_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_PUBLIC_URL",
] as const;

async function withStorageEnv(
  values: Partial<Record<(typeof STORAGE_ENV_KEYS)[number], string>>,
  run: () => Promise<void>
): Promise<void> {
  const previous = new Map<string, string | undefined>();

  for (const key of STORAGE_ENV_KEYS) {
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
    for (const key of STORAGE_ENV_KEYS) {
      const prior = previous.get(key);
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  }
}

test("local save/read/delete round trip", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "storage-local-"));

  try {
    await withStorageEnv(
      {
        STORAGE_DRIVER: "local",
        DATA_DIR: dataDir,
        PUBLIC_URL: "http://localhost:3000",
      },
      async () => {
        const key = "generated/local-roundtrip.mp4";
        const content = Buffer.from("hello-storage");

        await saveFile(key, content, "video/mp4");

        const filePath = localPath(key);
        assert.ok(filePath);

        const diskContent = await readFile(filePath);
        assert.equal(diskContent.toString("utf8"), "hello-storage");

        await deleteFile(key);

        await assert.rejects(readFile(filePath), /ENOENT/);
      }
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("key validation rejects traversal", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "storage-key-"));

  try {
    await withStorageEnv(
      {
        STORAGE_DRIVER: "local",
        DATA_DIR: dataDir,
        PUBLIC_URL: "http://localhost:3000",
      },
      async () => {
        await assert.rejects(
          saveFile("generated/../escape.mp4", Buffer.from("x"), "video/mp4"),
          /(traversal|invalid|\.\.)/i
        );
      }
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("publicUrl and keyFromUrl round trip for local and s3", async () => {
  const key = "generated/123e4567-e89b-12d3-a456-426614174000.mp4";

  await withStorageEnv(
    {
      STORAGE_DRIVER: "local",
      PUBLIC_URL: "https://app.example.com",
    },
    async () => {
      const url = publicUrl(key);
      assert.equal(
        url,
        "https://app.example.com/media/generated/123e4567-e89b-12d3-a456-426614174000.mp4"
      );
      assert.equal(keyFromUrl(url), key);
      assert.equal(keyFromUrl("https://other.example.com/media/generated/test.mp4"), null);
    }
  );

  await withStorageEnv(
    {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_BUCKET: "video-bucket",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_URL: "https://cdn.example.com/video-bucket",
    },
    async () => {
      const url = publicUrl(key);
      assert.equal(
        url,
        "https://cdn.example.com/video-bucket/generated/123e4567-e89b-12d3-a456-426614174000.mp4"
      );
      assert.equal(keyFromUrl(url), key);
      assert.equal(keyFromUrl("https://cdn.example.com/another/generated/test.mp4"), null);
    }
  );
});

test("media route serves full responses, ranges, and misses", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "storage-route-"));

  try {
    await withStorageEnv(
      {
        STORAGE_DRIVER: "local",
        DATA_DIR: dataDir,
        PUBLIC_URL: "http://localhost:3000",
      },
      async () => {
        const key = "generated/route-test.mp4";
        const content = Buffer.from("0123456789ABCDEFGHIJ", "utf8");

        await saveFile(key, content, "video/mp4");

        const fullResponse = await mediaGet(
          new Request("http://localhost:3000/media/generated/route-test.mp4"),
          { params: Promise.resolve({ key: ["generated", "route-test.mp4"] }) }
        );

        assert.equal(fullResponse.status, 200);
        assert.equal(fullResponse.headers.get("content-type"), "video/mp4");
        assert.equal(fullResponse.headers.get("content-length"), String(content.length));
        assert.equal(fullResponse.headers.get("accept-ranges"), "bytes");
        assert.equal(
          fullResponse.headers.get("cache-control"),
          "public, max-age=31536000, immutable"
        );
        assert.equal(Buffer.from(await fullResponse.arrayBuffer()).toString("utf8"), content.toString("utf8"));

        const rangeResponse = await mediaGet(
          new Request("http://localhost:3000/media/generated/route-test.mp4", {
            headers: {
              Range: "bytes=0-9",
            },
          }),
          { params: Promise.resolve({ key: ["generated", "route-test.mp4"] }) }
        );

        assert.equal(rangeResponse.status, 206);
        assert.equal(rangeResponse.headers.get("content-range"), `bytes 0-9/${content.length}`);
        assert.equal(rangeResponse.headers.get("content-length"), "10");
        assert.equal(Buffer.from(await rangeResponse.arrayBuffer()).toString("utf8"), "0123456789");

        const missingResponse = await mediaGet(
          new Request("http://localhost:3000/media/generated/missing.mp4"),
          { params: Promise.resolve({ key: ["generated", "missing.mp4"] }) }
        );

        assert.equal(missingResponse.status, 404);

        const traversalResponse = await mediaGet(
          new Request("http://localhost:3000/media/../secret.mp4"),
          { params: Promise.resolve({ key: ["..", "secret.mp4"] }) }
        );

        assert.ok(traversalResponse.status === 400 || traversalResponse.status === 404);
      }
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("s3 driver signs PUT uploads", async () => {
  let capturedUrl: string | null = null;
  let capturedMethod: string | null = null;
  let capturedAuthorization: string | null = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: URL | RequestInfo,
    init?: RequestInit
  ): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    capturedUrl = request.url;
    capturedMethod = request.method;
    capturedAuthorization = request.headers.get("authorization");
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await withStorageEnv(
      {
        STORAGE_DRIVER: "s3",
        S3_ENDPOINT: "https://s3.example.com",
        S3_REGION: "auto",
        S3_BUCKET: "video-bucket",
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-key",
        S3_PUBLIC_URL: "https://cdn.example.com/video-bucket",
      },
      async () => {
        await saveFile("generated/signed-upload.mp4", Buffer.from("video"), "video/mp4");
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!capturedUrl || !capturedMethod) {
    throw new Error("Expected fetch to be called");
  }

  assert.equal(capturedUrl, "https://s3.example.com/video-bucket/generated/signed-upload.mp4");
  assert.equal(capturedMethod, "PUT");
  assert.ok(capturedAuthorization);
});

test("s3 driver sends Content-Length when uploading a file stream", async () => {
  // S3-compatible stores reject chunked PUTs with 411 MissingContentLength.
  const dir = await mkdtemp(path.join(os.tmpdir(), "vidfiddle-s3-stream-"));
  const file = path.join(dir, "render.mp4");
  await writeFile(file, "rendered-video-bytes");
  let contentLength: string | null = null;
  let uploaded = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    contentLength = request.headers.get("content-length");
    uploaded = await request.text();
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await withStorageEnv(
      {
        STORAGE_DRIVER: "s3",
        S3_ENDPOINT: "https://s3.example.com",
        S3_REGION: "auto",
        S3_BUCKET: "video-bucket",
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-key",
        S3_PUBLIC_URL: "https://cdn.example.com/video-bucket",
      },
      async () => {
        await saveFile("generated/streamed.mp4", createReadStream(file), "video/mp4");
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(contentLength, String("rendered-video-bytes".length));
  assert.equal(uploaded, "rendered-video-bytes");
});
