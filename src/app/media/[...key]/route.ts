import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { localPath } from "@/lib/storage";

interface RouteParams {
  params: Promise<{ key: string[] }>;
}

type ByteRange = { start: number; end: number };

function contentTypeForFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/x-m4v";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function parseRange(rangeHeader: string | null, fileSize: number): ByteRange | "invalid" | null {
  if (!rangeHeader) {
    return null;
  }

  if (!rangeHeader.startsWith("bytes=")) {
    return "invalid";
  }

  const rangeValue = rangeHeader.slice("bytes=".length).trim();

  if (!rangeValue || rangeValue.includes(",")) {
    return "invalid";
  }

  const [startPart = "", endPart = ""] = rangeValue.split("-", 2);

  if (!startPart && !endPart) {
    return "invalid";
  }

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart, 10);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || fileSize === 0) {
      return "invalid";
    }

    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number.parseInt(startPart, 10);

  if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
    return "invalid";
  }

  if (!endPart) {
    return { start, end: fileSize - 1 };
  }

  const parsedEnd = Number.parseInt(endPart, 10);

  if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
    return "invalid";
  }

  return { start, end: Math.min(parsedEnd, fileSize - 1) };
}

function buildHeaders(contentType: string): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");

  let filePath: string | null;

  try {
    filePath = localPath(key);
  } catch {
    return new Response("Invalid media key", { status: 400 });
  }

  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  let fileStats;

  try {
    fileStats = await stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (!fileStats.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const contentType = contentTypeForFile(filePath);
  const headers = buildHeaders(contentType);
  const range = parseRange(request.headers.get("range"), fileStats.size);

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${fileStats.size}`);
    return new Response("Requested Range Not Satisfiable", {
      status: 416,
      headers,
    });
  }

  if (!range) {
    headers.set("Content-Length", String(fileStats.size));

    return new Response(
      Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
      {
        status: 200,
        headers,
      }
    );
  }

  const chunkSize = range.end - range.start + 1;
  headers.set("Content-Length", String(chunkSize));
  headers.set(
    "Content-Range",
    `bytes ${range.start}-${range.end}/${fileStats.size}`
  );

  return new Response(
    Readable.toWeb(
      createReadStream(filePath, {
        start: range.start,
        end: range.end,
      })
    ) as ReadableStream<Uint8Array>,
    {
      status: 206,
      headers,
    }
  );
}
