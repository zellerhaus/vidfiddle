/**
 * Client for the worker service (src/worker), which handles YouTube video download and clip
 * cutting via yt-dlp and ffmpeg.
 *
 * Both endpoints are async — the worker accepts the job, returns immediately,
 * and processes in the background. Results are written directly to the DB.
 */

interface AcceptedResponse {
  accepted: boolean;
}

/**
 * Get the worker base URL and validate config. The RAILWAY_WORKER_* names from the hosted setup
 * still work.
 */
function getWorkerConfig(): { baseUrl: string; secret: string } {
  const baseUrl = process.env.WORKER_URL || process.env.RAILWAY_WORKER_URL;
  const secret = process.env.WORKER_SECRET || process.env.RAILWAY_WORKER_SECRET;

  if (!baseUrl) {
    throw new Error("WORKER_URL environment variable is not set");
  }
  if (!secret) {
    throw new Error("WORKER_SECRET environment variable is not set");
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

/**
 * Make an authenticated request to the worker
 */
async function workerFetch(
  path: string,
  body: Record<string, unknown>
): Promise<Response> {
  const { baseUrl, secret } = getWorkerConfig();

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Worker error (${response.status}): ${errorText}`
    );
  }

  return response;
}

/**
 * Request async YouTube video download.
 * The worker downloads via yt-dlp and saves to storage in the background.
 * When complete, it updates the youtube_sources row directly (sets source_video_url).
 * On failure, it sets the source status to 'failed'.
 */
export async function downloadYouTubeVideo(
  youtubeUrl: string,
  sourceId: string
): Promise<AcceptedResponse> {
  console.log("[Worker] Requesting async download:", youtubeUrl);

  const response = await workerFetch("/download", {
    youtubeUrl,
    sourceId,
  });

  const result: AcceptedResponse = await response.json();

  console.log("[Worker] Download accepted, processing in background");

  return result;
}

/**
 * Request async clip cutting.
 * The worker downloads the source, cuts with ffmpeg, and uploads the clip in the background.
 * When complete, it updates the youtube_clips row directly (sets raw_clip_url).
 * On failure, it sets the clip status to 'failed'.
 */
export async function cutClip(params: {
  videoUrl: string;
  startTime: number;
  endTime: number;
  clipId: string;
}): Promise<AcceptedResponse> {
  console.log(
    `[Worker] Requesting async clip cut: ${params.startTime}s - ${params.endTime}s`
  );

  const response = await workerFetch("/cut", {
    videoUrl: params.videoUrl,
    startTime: params.startTime,
    endTime: params.endTime,
    clipId: params.clipId,
  });

  const result: AcceptedResponse = await response.json();

  console.log("[Worker] Clip cut accepted, processing in background");

  return result;
}

/**
 * Check if the worker is configured and healthy
 */
export async function isWorkerConfigured(): Promise<boolean> {
  try {
    const { baseUrl, secret } = getWorkerConfig();

    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}
