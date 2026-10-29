const PUBLER_API_URL = "https://app.publer.com/api/v1";

function getHeaders(includeWorkspace = true): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer-API ${process.env.PUBLER_API_KEY}`,
  };

  if (includeWorkspace && process.env.PUBLER_WORKSPACE_ID) {
    headers["Publer-Workspace-Id"] = process.env.PUBLER_WORKSPACE_ID;
  }

  return headers;
}

export interface PublerWorkspace {
  id: string;
  name: string;
}

export interface PublerAccount {
  id: string;
  name: string;
  platform: string;
  profile_url?: string;
  avatar_url?: string;
  username?: string;
}

export interface PublerJobStatus {
  status: "pending" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export interface PublerMedia {
  id: string;
  type: "video" | "image";
  url?: string;
}

// Upload media from a URL (for videos/images hosted externally)
export async function uploadMediaFromUrl(url: string, name?: string): Promise<{ jobId: string }> {
  console.log("[Publer] Uploading media from URL:", url);

  // Extract filename from URL or use provided name
  const fileName = name || url.split("/").pop()?.split("?")[0] || "video";

  // Publer expects media as an array with url and name fields
  const body = {
    media: [
      {
        url,
        name: fileName,
      },
    ],
    type: "single",
  };

  console.log("[Publer] Media upload request body:", JSON.stringify(body, null, 2));

  const response = await fetch(`${PUBLER_API_URL}/media/from-url`, {
    method: "POST",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  console.log("[Publer] Media upload response status:", response.status);
  console.log("[Publer] Media upload response body:", responseText);

  if (!response.ok) {
    throw new Error(`Failed to upload media: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Publer] Media upload job created:", data.job_id);
  return { jobId: data.job_id };
}

// Recursively search for a media ID in various Publer response structures
function extractMediaId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  // Direct: {id: "..."}
  if (typeof obj.id === "string" && obj.id.length > 0) return obj.id;
  if (typeof obj._id === "string" && obj._id.length > 0) return obj._id;

  // Nested in media array: {media: [{id: "..."}]}
  if (Array.isArray(obj.media) && obj.media.length > 0) {
    const first = obj.media[0] as Record<string, unknown>;
    if (typeof first?.id === "string") return first.id;
    if (typeof first?._id === "string") return first._id;
  }

  // Nested in payload: {payload: {id: "..."}} or {payload: {media: [...]}}
  if (obj.payload && typeof obj.payload === "object") {
    const found = extractMediaId(obj.payload);
    if (found) return found;
  }

  // Result is an array: [{id: "..."}]
  if (Array.isArray(data) && data.length > 0) {
    const found = extractMediaId(data[0]);
    if (found) return found;
  }

  // Nested in result: {result: {...}}
  if (obj.result && typeof obj.result === "object") {
    const found = extractMediaId(obj.result);
    if (found) return found;
  }

  return null;
}

// Wait for media upload to complete and return the media info
export async function waitForMediaUpload(
  jobId: string,
  maxAttempts = 60,
  intervalMs = 3000
): Promise<PublerMedia> {
  console.log("[Publer] Waiting for media upload to complete, job:", jobId);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getJobStatus(jobId);
    console.log(`[Publer] Media upload attempt ${attempt}/${maxAttempts}, status:`, status.status);

    if (status.status === "completed") {
      console.log("[Publer] Media upload completed, result:", JSON.stringify(status.result));

      const mediaId = extractMediaId(status.result);

      if (!mediaId) {
        const resultStr = JSON.stringify(status.result);
        console.error("[Publer] Could not extract media ID from result:", resultStr);
        throw new Error(`Media upload completed but no media ID found in: ${resultStr.slice(0, 500)}`);
      }

      console.log("[Publer] Media upload completed, ID:", mediaId);
      return {
        id: mediaId,
        type: "video" as const,
        url: undefined,
      };
    }

    if (status.status === "failed") {
      throw new Error(`Media upload failed: ${status.error || "Unknown error"}`);
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Media upload timed out after ${maxAttempts} attempts`);
}

// Get all workspaces
export async function getWorkspaces(): Promise<PublerWorkspace[]> {
  const response = await fetch(`${PUBLER_API_URL}/workspaces`, {
    headers: getHeaders(false),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`);
  }

  return response.json();
}

// Get all social accounts in the workspace
export async function getAccounts(): Promise<PublerAccount[]> {
  const response = await fetch(`${PUBLER_API_URL}/accounts`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch accounts: ${response.status}`);
  }

  const rawAccounts = await response.json();

  // Log raw response for debugging
  console.log("[Publer] Raw accounts from API:", JSON.stringify(rawAccounts, null, 2));

  // Map the API response to our expected format
  // Publer uses 'type' (e.g., 'ig_business') and 'provider' (e.g., 'instagram')
  return rawAccounts.map((account: Record<string, unknown>) => {
    const rawType = account.type as string;
    const rawProvider = account.provider as string;
    const mappedPlatform = mapPublerPlatformToStandard(rawType || rawProvider);
    console.log(`[Publer] Mapping platform: type="${rawType}", provider="${rawProvider}" -> "${mappedPlatform}"`);

    return {
      id: account.id as string,
      name: (account.name || account.display_name || account.username || 'Unknown') as string,
      platform: mappedPlatform,
      profile_url: account.profile_url as string | undefined,
      avatar_url: (account.picture || account.avatar || account.avatar_url) as string | undefined,
      username: account.username as string | undefined,
    };
  });
}

// Schedule a video post to multiple accounts
export async function scheduleVideoPost(params: {
  videoUrl: string;
  accounts: Array<{
    accountId: string;
    platform: string;
    caption: string;
    title?: string; // Used for YouTube title (max 100 chars)
    scheduledAt?: string; // ISO 8601 timestamp for manual scheduling
  }>;
  autoSchedule?: boolean;
  batchIndex?: number; // Position of this video in a batch (0-based)
  batchSize?: number; // Total number of videos in the batch
}): Promise<{ jobId: string; mediaId: string }> {
  const { videoUrl, accounts, autoSchedule = true, batchIndex = 0, batchSize = 1 } = params;

  // Step 1: Upload video to Publer (required per docs - can't use media_url directly)
  console.log("[Publer] Step 1: Uploading video to Publer...");
  const { jobId: uploadJobId } = await uploadMediaFromUrl(videoUrl);

  // Step 2: Wait for upload to complete
  console.log("[Publer] Step 2: Waiting for video upload to complete...");
  const media = await waitForMediaUpload(uploadJobId);
  console.log("[Publer] Video uploaded successfully, media ID:", media.id);

  // Step 3: Build the posts array for each account using media ID
  const posts = accounts.map((account) => {
    const networkContent: Record<string, unknown> = {};

    // Different platforms have different content structures
    const platformKey = mapPlatformToNetwork(account.platform);
    const content: Record<string, unknown> = {
      type: "video",
      text: account.caption,
      media: [
        {
          id: media.id,
          type: "video",
        },
      ],
    };

    // YouTube-specific fields (title required, details object for privacy/type)
    if (account.platform === "youtube") {
      const title = account.title || account.caption.split("\n")[0];
      content.title = title.slice(0, 100);
      content.details = {
        type: "short",
        privacy: "public",
      };
    }

    networkContent[platformKey] = content;

    // Build account entry — include scheduled_at if provided (for manual scheduling)
    const accountEntry: Record<string, unknown> = {
      id: account.accountId,
    };
    if (!autoSchedule && account.scheduledAt) {
      accountEntry.scheduled_at = account.scheduledAt;
    }

    const post: Record<string, unknown> = {
      networks: networkContent,
      accounts: [accountEntry],
    };

    // Platforms that don't support Publer's auto-scheduling (no posting schedule
    // configured, or the platform silently drops auto-scheduled posts)
    const needsExplicitSchedule = ["youtube", "tiktok"].includes(account.platform);

    // Spread posts across days based on batch position so they don't all
    // stack at the same timestamp (which causes TikTok/YouTube to silently drop posts)
    const dayOffset = batchIndex + 1; // 1-based: first video = day 1, second = day 2, etc.

    if (autoSchedule && needsExplicitSchedule) {
      // Schedule at dayOffset days from now (staggered across the batch)
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + dayOffset);
      accountEntry.scheduled_at = scheduledAt.toISOString();
    } else if (autoSchedule) {
      // Let Publer pick the best time within a range sized to the batch
      const rangeInDays = Math.max(batchSize, 1);
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + rangeInDays);
      post.auto = true;
      post.share_next = true;
      post.range = {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      };
    }

    return post;
  });

  // Step 4: Schedule the posts
  const body = {
    bulk: {
      state: "scheduled",
      posts,
    },
  };

  console.log("[Publer] Scheduling post with body:", JSON.stringify(body, null, 2));

  const response = await fetch(`${PUBLER_API_URL}/posts/schedule`, {
    method: "POST",
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  console.log("[Publer] Schedule response status:", response.status);
  console.log("[Publer] Schedule response body:", responseText);

  if (!response.ok) {
    throw new Error(`Failed to schedule post: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Publer] Job created with ID:", data.job_id);
  return { jobId: data.job_id, mediaId: media.id };
}

// Check job status (posts are created asynchronously)
export async function getJobStatus(jobId: string): Promise<PublerJobStatus> {
  const response = await fetch(`${PUBLER_API_URL}/job_status/${jobId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to check job status: ${response.status}`);
  }

  const raw = await response.json();
  console.log("[Publer] Raw job status response:", JSON.stringify(raw));

  // Publer job_status returns:
  // - While processing: a string like "working" or "pending"
  // - On completion: the actual result (object or array) directly
  // - On failure: could be {error: "..."} or a string "error"/"failed"

  // Case 1: Raw response is a string (in-progress or status indicator)
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    if (s === "complete" || s === "completed") {
      return { status: "completed", result: undefined, error: undefined };
    }
    if (s === "failed" || s === "error") {
      return { status: "failed", result: undefined, error: raw };
    }
    // "working", "pending", etc. → still in progress
    return { status: "pending", result: undefined, error: undefined };
  }

  // Case 2: Raw response is boolean false (Publer returns false while processing)
  if (raw === false || raw === null) {
    return { status: "pending", result: undefined, error: undefined };
  }

  // Case 3: Raw response is an object with a status field
  if (raw?.status || raw?.data?.status) {
    const statusStr = (raw?.data?.status || raw?.status || "").toString().toLowerCase();
    if (statusStr === "complete" || statusStr === "completed") {
      return { status: "completed", result: raw?.data?.result ?? raw?.result ?? raw, error: undefined };
    }
    if (statusStr === "failed" || statusStr === "error") {
      return { status: "failed", result: undefined, error: raw?.data?.error ?? raw?.error ?? "Unknown error" };
    }
    if (statusStr === "working" || statusStr === "pending") {
      return { status: "pending", result: undefined, error: undefined };
    }
  }

  // Case 4: Raw response is an object/array without a status field
  // This means the job completed and Publer returned the result directly
  console.log("[Publer] Job status returned a result object - treating as completed");
  return { status: "completed", result: raw, error: undefined };
}

// Map Publer's platform names to our standard platform names
function mapPublerPlatformToStandard(publerPlatform: string | undefined | null): string {
  if (!publerPlatform) {
    return "unknown";
  }

  const normalized = publerPlatform.toLowerCase().trim();

  const mapping: Record<string, string> = {
    // Instagram variants
    ig_business: "instagram",
    ig_personal: "instagram",
    instagram: "instagram",
    // LinkedIn variants
    in_page: "linkedin",
    in_profile: "linkedin",
    linkedin: "linkedin",
    // TikTok variants
    tiktok: "tiktok",
    tt_business: "tiktok",
    // YouTube
    youtube: "youtube",
    yt_channel: "youtube",
    // Twitter/X
    twitter: "twitter",
    x: "twitter",
    // Facebook variants
    fb_page: "facebook",
    fb_group: "facebook",
    facebook: "facebook",
  };

  return mapping[normalized] || normalized;
}

// Map our platform names to Publer's network names
function mapPlatformToNetwork(platform: string): string {
  const mapping: Record<string, string> = {
    instagram: "instagram",
    tiktok: "tiktok",
    youtube: "youtube",
    linkedin: "linkedin",
    twitter: "twitter",
    facebook: "facebook",
  };
  return mapping[platform] || platform;
}

// Wait for a schedule job to complete and extract the created post IDs
export async function waitForScheduleJob(
  jobId: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<Array<{ publerPostId: string; accountId: string }>> {
  console.log("[Publer] Waiting for schedule job to complete, job:", jobId);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getJobStatus(jobId);
    console.log(`[Publer] Schedule job attempt ${attempt}/${maxAttempts}, status:`, status.status);

    if (status.status === "completed") {
      console.log("[Publer] Schedule job completed, result:", JSON.stringify(status.result));
      return extractPostIds(status.result);
    }

    if (status.status === "failed") {
      console.error("[Publer] Schedule job failed:", status.error);
      return [];
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.error(`[Publer] Schedule job timed out after ${maxAttempts} attempts`);
  return [];
}

// Extract post IDs from a Publer schedule job result
function extractPostIds(
  result: unknown
): Array<{ publerPostId: string; accountId: string }> {
  const posts: Array<{ publerPostId: string; accountId: string }> = [];

  if (!result) return posts;

  // The result can be an array of post objects or a single object
  const items = Array.isArray(result) ? result : [result];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const id = (obj.id || obj._id) as string | undefined;
    const accountId = (obj.account_id || obj.accountId) as string | undefined;

    if (id && accountId) {
      posts.push({ publerPostId: id, accountId });
    }

    // Some responses nest posts in a "posts" array
    if (Array.isArray(obj.posts)) {
      for (const nested of obj.posts) {
        if (!nested || typeof nested !== "object") continue;
        const n = nested as Record<string, unknown>;
        const nId = (n.id || n._id) as string | undefined;
        const nAccountId = (n.account_id || n.accountId) as string | undefined;
        if (nId && nAccountId) {
          posts.push({ publerPostId: nId, accountId: nAccountId });
        }
      }
    }
  }

  console.log("[Publer] Extracted post IDs:", JSON.stringify(posts));
  return posts;
}

// Get a single post by its Publer post ID
export async function getPost(postId: string): Promise<{
  id: string;
  state: string;
  scheduled_at?: string;
  published_at?: string;
  error?: string;
  post_link?: string;
} | null> {
  try {
    const response = await fetch(`${PUBLER_API_URL}/posts/${postId}`, {
      headers: getHeaders(),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.error(`[Publer] Error fetching post ${postId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      id: data.id || data._id,
      state: data.state || data.status || "unknown",
      scheduled_at: data.scheduled_at,
      published_at: data.published_at,
      error: data.error,
      post_link: data.post_link || data.url,
    };
  } catch (error) {
    console.error(`[Publer] Error fetching post ${postId}:`, error);
    return null;
  }
}

// Check if Publer is configured
export function isPublerConfigured(): boolean {
  return !!(process.env.PUBLER_API_KEY && process.env.PUBLER_WORKSPACE_ID);
}
