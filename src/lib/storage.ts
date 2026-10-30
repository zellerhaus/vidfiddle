import { createWriteStream, type ReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { AwsClient } from "aws4fetch";

type StorageDriver = "local" | "s3";

const VALID_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/;

let hasWarnedMissingPublicUrl = false;

export function getStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER?.toLowerCase() === "s3" ? "s3" : "local";
}

function getDataDir(): string {
  return process.env.DATA_DIR || "./data";
}

function getMediaRoot(): string {
  return path.resolve(getDataDir(), "media");
}

function getPublicBaseUrl(): string {
  const publicUrl = process.env.PUBLIC_URL?.trim();

  if (publicUrl) {
    return publicUrl.replace(/\/+$/, "");
  }

  if (!hasWarnedMissingPublicUrl) {
    console.warn(
      "[Storage] PUBLIC_URL is not set. Falling back to http://localhost:3000. Social platforms may be unable to fetch media URLs."
    );
    hasWarnedMissingPublicUrl = true;
  }

  return "http://localhost:3000";
}

function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim() || "auto";
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const publicUrl = process.env.S3_PUBLIC_URL?.trim();

  const missing: string[] = [];

  if (!endpoint) missing.push("S3_ENDPOINT");
  if (!bucket) missing.push("S3_BUCKET");
  if (!accessKeyId) missing.push("S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");
  if (!publicUrl) missing.push("S3_PUBLIC_URL");

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl,
    missing,
    isComplete: missing.length === 0,
  };
}

function ensureS3Config() {
  const config = getS3Config();

  if (!config.isComplete) {
    throw new Error(
      `[Storage] S3 driver is missing required environment variables: ${config.missing.join(", ")}`
    );
  }

  return {
    endpoint: config.endpoint!,
    region: config.region,
    bucket: config.bucket!,
    accessKeyId: config.accessKeyId!,
    secretAccessKey: config.secretAccessKey!,
    publicUrl: config.publicUrl!,
  };
}

function ensureValidKey(key: string): string {
  if (!key) {
    throw new Error("[Storage] Key cannot be empty");
  }

  if (key.startsWith("/")) {
    throw new Error("[Storage] Key cannot start with '/'");
  }

  if (key.includes("\\")) {
    throw new Error("[Storage] Key cannot contain backslashes");
  }

  if (key.includes("..")) {
    throw new Error("[Storage] Key cannot contain '..'");
  }

  if (!VALID_KEY_PATTERN.test(key)) {
    throw new Error("[Storage] Key contains invalid characters");
  }

  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("[Storage] Key cannot contain path traversal segments");
  }

  return key;
}

function encodeKeyForUrl(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizePathnamePrefix(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "" : withoutTrailingSlash;
}

function extractKeyWithPrefix(url: URL, prefixUrl: URL): string | null {
  if (url.origin !== prefixUrl.origin) {
    return null;
  }

  if (!url.pathname.startsWith(prefixUrl.pathname)) {
    return null;
  }

  const encodedKey = url.pathname.slice(prefixUrl.pathname.length);

  if (!encodedKey) {
    return null;
  }

  const key = decodeURIComponent(encodedKey);

  try {
    return ensureValidKey(key);
  } catch {
    return null;
  }
}

function buildLocalPath(key: string): string {
  const validatedKey = ensureValidKey(key);
  const root = getMediaRoot();
  const absolutePath = path.resolve(root, validatedKey);

  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("[Storage] Resolved path is outside the media directory");
  }

  return absolutePath;
}

function createVideoKey(videoId: string): string {
  return `generated/${videoId}.mp4`;
}

/**
 * Download a video from a URL and return as Buffer
 */
export async function downloadVideo(url: string): Promise<Buffer> {
  console.log("[Storage] Downloading video from:", url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function saveFile(
  key: string,
  data: Buffer | Readable,
  contentType: string
): Promise<void> {
  const validatedKey = ensureValidKey(key);

  if (getStorageDriver() === "s3") {
    const config = ensureS3Config();
    const awsClient = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: "s3",
    });

    const encodedKey = encodeKeyForUrl(validatedKey);
    const endpoint = config.endpoint.replace(/\/+$/, "");
    const objectUrl = `${endpoint}/${config.bucket}/${encodedKey}`;

    // S3 rejects chunked uploads (411 MissingContentLength), so the size must be known up front.
    // File streams (renders, YouTube downloads) are sized with stat and still streamed; any other
    // stream is buffered first.
    const filePath = Buffer.isBuffer(data) ? null : (data as ReadStream).path;
    let body: BodyInit;
    let contentLength: number;
    if (Buffer.isBuffer(data)) {
      body = new Uint8Array(data);
      contentLength = data.length;
    } else if (typeof filePath === "string") {
      contentLength = (await stat(filePath)).size;
      body = Readable.toWeb(data) as unknown as BodyInit;
    } else {
      const buffered = await buffer(data);
      body = new Uint8Array(buffered);
      contentLength = buffered.length;
    }

    const requestInit: RequestInit & { duplex?: "half" } = {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
      },
      body,
    };

    if (typeof filePath === "string") {
      requestInit.duplex = "half";
    }

    const response = await awsClient.fetch(objectUrl, requestInit);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[Storage] Failed to upload file to S3 (${response.status} ${response.statusText}): ${text}`
      );
    }

    return;
  }

  const destination = buildLocalPath(validatedKey);
  const destinationDir = path.dirname(destination);
  await mkdir(destinationDir, { recursive: true });

  const tempPath = `${destination}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    if (Buffer.isBuffer(data)) {
      await pipeline(Readable.from(data), createWriteStream(tempPath));
    } else {
      await pipeline(data, createWriteStream(tempPath));
    }

    await rename(tempPath, destination);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deleteFile(key: string): Promise<void> {
  const validatedKey = ensureValidKey(key);

  if (getStorageDriver() === "s3") {
    const config = ensureS3Config();
    const awsClient = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: "s3",
    });

    const encodedKey = encodeKeyForUrl(validatedKey);
    const endpoint = config.endpoint.replace(/\/+$/, "");
    const objectUrl = `${endpoint}/${config.bucket}/${encodedKey}`;

    const response = await awsClient.fetch(objectUrl, {
      method: "DELETE",
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new Error(
        `[Storage] Failed to delete file from S3 (${response.status} ${response.statusText}): ${text}`
      );
    }

    return;
  }

  const filePath = buildLocalPath(validatedKey);
  await rm(filePath, { force: true });
}

export function publicUrl(key: string): string {
  const validatedKey = ensureValidKey(key);

  if (getStorageDriver() === "s3") {
    const config = ensureS3Config();
    const baseUrl = config.publicUrl.replace(/\/+$/, "");
    return `${baseUrl}/${encodeKeyForUrl(validatedKey)}`;
  }

  const baseUrl = getPublicBaseUrl();
  return `${baseUrl}/media/${encodeKeyForUrl(validatedKey)}`;
}

export function keyFromUrl(url: string): string | null {
  const parsedUrl = parseUrl(url);

  if (!parsedUrl) {
    return null;
  }

  if (getStorageDriver() === "s3") {
    const config = getS3Config();

    if (!config.publicUrl) {
      return null;
    }

    const publicBase = parseUrl(`${config.publicUrl.replace(/\/+$/, "")}/`);

    if (!publicBase) {
      return null;
    }

    return extractKeyWithPrefix(parsedUrl, publicBase);
  }

  const baseUrl = parseUrl(getPublicBaseUrl());

  if (!baseUrl) {
    return null;
  }

  const pathPrefix = normalizePathnamePrefix(baseUrl.pathname);
  const mediaBase = parseUrl(
    `${baseUrl.origin}${pathPrefix}/media/`.replace(/([^:]\/)\/+/, "$1")
  );

  if (!mediaBase) {
    return null;
  }

  return extractKeyWithPrefix(parsedUrl, mediaBase);
}

export function localPath(key: string): string | null {
  if (getStorageDriver() !== "local") {
    return null;
  }

  return buildLocalPath(key);
}

/**
 * Upload a video buffer to storage.
 * Returns the public URL of the uploaded video.
 */
export async function uploadVideoToStorage(
  videoBuffer: Buffer,
  videoId: string,
  contentType: string = "video/mp4"
): Promise<string> {
  const key = createVideoKey(videoId);

  console.log("[Storage] Uploading video to:", key);

  await saveFile(key, videoBuffer, contentType);

  const url = publicUrl(key);
  console.log("[Storage] Video uploaded, public URL:", url);

  return url;
}

/**
 * Download video from a source URL and upload to storage.
 * Returns the public URL.
 */
export async function transferVideoToStorage(
  sourceUrl: string,
  videoId: string
): Promise<string> {
  const key = createVideoKey(videoId);

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "video/mp4";

  if (response.body) {
    await saveFile(
      key,
      Readable.fromWeb(response.body as unknown as NodeReadableStream),
      contentType
    );
  } else {
    const arrayBuffer = await response.arrayBuffer();
    await saveFile(key, Buffer.from(arrayBuffer), contentType);
  }

  const url = publicUrl(key);
  console.log("[Storage] Video transferred, public URL:", url);

  return url;
}

/**
 * Delete a video from storage
 */
export async function deleteVideoFromStorage(videoId: string): Promise<void> {
  const key = createVideoKey(videoId);

  await deleteFile(key);

  console.log("[Storage] Video deleted:", key);
}

/**
 * Check if storage is configured.
 */
export async function isStorageConfigured(): Promise<boolean> {
  try {
    if (getStorageDriver() === "s3") {
      return getS3Config().isComplete;
    }

    await mkdir(getMediaRoot(), { recursive: true });
    return true;
  } catch (error) {
    console.error("[Storage] Error checking storage:", error);
    return false;
  }
}
