import type { Platform } from "@/lib/supabase/types";
import type {
  Publisher,
  PublisherAccount,
  PublisherPostStatus,
  PublisherScheduleAccount,
  PublisherScheduleParams,
  PublisherScheduledPost,
} from "./types";

interface LightPostAccount {
  id: string;
  platform: string;
  name?: string;
  handle?: string;
}

interface LightPostStateResponse {
  accounts: LightPostAccount[];
}

interface LightPostMediaResponse {
  id: string;
}

interface LightPostResult {
  accountId: string;
  status: string;
  message?: string;
  remoteId?: string;
  url?: string;
}

interface LightPostPost {
  id: string;
  status: string;
  scheduledAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  message?: string;
  accountIds?: string[];
  results?: LightPostResult[];
}

interface LightPostListPostsResponse {
  posts: LightPostPost[];
  total: number;
}

interface LightPostCreatePostResponse {
  id: string;
}

const LIGHTPOST_VIDEO_PLATFORM_MESSAGES: Partial<Record<Platform, string>> = {
  tiktok: "LightPost can't post video to TikTok yet.",
  youtube: "LightPost can't post video to YouTube yet.",
  twitter: "LightPost can't post video to X yet.",
};

const LIGHTPOST_TO_APP_PLATFORM: Record<string, Platform | null> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  x: "twitter",
  threads: null,
  bluesky: null,
  mastodon: null,
  telegram: null,
  discord: null,
};

const APP_TO_LIGHTPOST_PLATFORM: Record<Platform, string> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  twitter: "x",
  tiktok: "tiktok",
  youtube: "youtube",
};

function parseLightPostAccounts(value: string | undefined): Map<Platform, string> {
  const mapped = new Map<Platform, string>();

  if (!value) {
    return mapped;
  }

  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const [platform, accountId] = trimmed.split("=").map((item) => item?.trim());
    if (!platform || !accountId) {
      continue;
    }

    if (
      platform === "instagram" ||
      platform === "facebook" ||
      platform === "linkedin" ||
      platform === "twitter" ||
      platform === "tiktok" ||
      platform === "youtube"
    ) {
      mapped.set(platform, accountId);
    }
  }

  return mapped;
}

function extractErrorMessage(rawBody: string): string {
  if (!rawBody) {
    return "LightPost request failed";
  }

  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // Best effort parsing only.
  }

  return rawBody;
}

function parseSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) {
    return null;
  }

  const match = /(?:^|,\s*)lightpost_session=([^;]+)/.exec(setCookie);
  if (!match) {
    return null;
  }

  return `lightpost_session=${match[1]}`;
}

function normalizeState(post: LightPostPost, result: LightPostResult | undefined): PublisherPostStatus {
  const postedStatuses = new Set(["published", "simulated"]);

  if (result && postedStatuses.has(result.status)) {
    return {
      id: post.id,
      state: "published",
      scheduled_at: post.scheduledAt,
      published_at: post.finishedAt || post.updatedAt,
      post_link: result.url,
      remote_post_id: result.remoteId,
    };
  }

  if (result?.status === "failed") {
    return {
      id: post.id,
      state: "failed",
      scheduled_at: post.scheduledAt,
      error: result.message || post.message,
    };
  }

  if (["failed", "partial", "blocked", "needs_review", "cancelled"].includes(post.status)) {
    return {
      id: post.id,
      state: "failed",
      scheduled_at: post.scheduledAt,
      error: result?.message || post.message || "Delivery failed in LightPost",
    };
  }

  return {
    id: post.id,
    state: "scheduled",
    scheduled_at: post.scheduledAt,
  };
}

function getAutoScheduledAt(batchIndex = 0, batchSize = 1): string {
  const scheduleDate = new Date(Date.now() + 60_000);
  if (batchSize > 1) {
    scheduleDate.setDate(scheduleDate.getDate() + batchIndex + 1);
  }
  return scheduleDate.toISOString();
}

export function isLightPostConfigured(): boolean {
  return !!process.env.LIGHTPOST_URL;
}

export function createLightPostPublisher(): Publisher {
  const baseUrl = (process.env.LIGHTPOST_URL || "").replace(/\/+$/, "");
  const password = process.env.LIGHTPOST_PASSWORD;
  const accountOverrides = parseLightPostAccounts(process.env.LIGHTPOST_ACCOUNTS);
  const scheduledJobs = new Map<string, PublisherScheduledPost[]>();
  let sessionCookie: string | null = null;

  async function login(): Promise<void> {
    if (!baseUrl) {
      throw new Error("LIGHTPOST_URL is required for LightPost publishing.");
    }

    const response = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: password || "" }),
    });

    if (!response.ok) {
      const body = await response.text();
      const message = extractErrorMessage(body);

      if (response.status === 429) {
        throw new Error(`${message} LightPost login is limited to 10 attempts per 10 minutes.`);
      }

      if (response.status === 403 && body.toLowerCase().includes("loopback")) {
        throw new Error(
          "LightPost requires a loopback hostname when LIGHTPOST_PASSWORD is unset. Set LIGHTPOST_PASSWORD or use localhost/127.0.0.1 for LIGHTPOST_URL."
        );
      }

      throw new Error(`LightPost login failed: ${message}`);
    }

    const parsedCookie = parseSessionCookie(response.headers.get("set-cookie"));
    if (!parsedCookie) {
      throw new Error("LightPost login succeeded but no lightpost_session cookie was returned.");
    }

    sessionCookie = parsedCookie;
  }

  async function request(path: string, init: RequestInit = {}, retryOn401 = true): Promise<Response> {
    if (!baseUrl) {
      throw new Error("LIGHTPOST_URL is required for LightPost publishing.");
    }

    if (path !== "/api/login" && password && !sessionCookie) {
      await login();
    }

    const headers = new Headers(init.headers);
    if (sessionCookie) {
      headers.set("Cookie", sessionCookie);
    }
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 401 && retryOn401 && path !== "/api/login") {
      sessionCookie = null;
      await login();
      return request(path, init, false);
    }

    return response;
  }

  async function requestJson<T>(
    path: string,
    init: RequestInit = {},
    context: "generic" | "mediaImport" = "generic"
  ): Promise<T> {
    const response = await request(path, init);

    if (!response.ok) {
      const body = await response.text();
      const message = extractErrorMessage(body);

      if (response.status === 403 && body.toLowerCase().includes("loopback")) {
        throw new Error(
          "LightPost requires a loopback hostname when LIGHTPOST_PASSWORD is unset. Set LIGHTPOST_PASSWORD or use localhost/127.0.0.1 for LIGHTPOST_URL."
        );
      }

      if (context === "mediaImport") {
        throw new Error(
          `${message} LightPost only imports public HTTPS media URLs. Ensure PUBLIC_URL is publicly reachable and points to a direct MP4 URL.`
        );
      }

      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  async function getState(): Promise<LightPostStateResponse> {
    return requestJson<LightPostStateResponse>("/api/state");
  }

  function assertVideoPlatformSupported(platform: Platform): void {
    const errorMessage = LIGHTPOST_VIDEO_PLATFORM_MESSAGES[platform];
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  }

  function mapAccountForUi(account: LightPostAccount): PublisherAccount | null {
    const appPlatform = LIGHTPOST_TO_APP_PLATFORM[account.platform] || null;
    if (!appPlatform) {
      return null;
    }

    return {
      id: account.id,
      name: account.name || account.handle || account.id,
      platform: appPlatform,
      username: account.handle,
    };
  }

  function resolveAccountIds(
    account: PublisherScheduleAccount,
    stateAccounts: LightPostAccount[]
  ): string[] {
    const overrideAccountId = accountOverrides.get(account.platform);

    if (overrideAccountId) {
      const override = stateAccounts.find((item) => item.id === overrideAccountId);
      if (!override) {
        throw new Error(
          `LIGHTPOST_ACCOUNTS maps ${account.platform} to ${overrideAccountId}, but that account is not connected in LightPost.`
        );
      }
      return [overrideAccountId];
    }

    if (account.accountId) {
      return [account.accountId];
    }

    const platformId = APP_TO_LIGHTPOST_PLATFORM[account.platform];
    const matching = stateAccounts
      .filter((item) => item.platform === platformId)
      .map((item) => item.id);

    if (matching.length === 0) {
      throw new Error(`No LightPost accounts are connected for platform: ${account.platform}`);
    }

    return matching;
  }

  async function findPostById(postId: string): Promise<LightPostPost | null> {
    let offset = 0;

    for (let page = 0; page < 100; page++) {
      const response = await requestJson<LightPostListPostsResponse>(`/api/posts?offset=${offset}`);
      const found = response.posts.find((post) => post.id === postId);
      if (found) {
        return found;
      }

      offset += response.posts.length;
      if (response.posts.length === 0 || offset >= response.total) {
        break;
      }
    }

    return null;
  }

  return {
    name: "lightpost",
    async getAccounts(): Promise<PublisherAccount[]> {
      const state = await getState();
      return state.accounts
        .map((account) => mapAccountForUi(account))
        .filter((account): account is PublisherAccount => account !== null);
    },
    async scheduleVideoPost(params: PublisherScheduleParams): Promise<{ jobId: string; mediaId?: string }> {
      for (const account of params.accounts) {
        assertVideoPlatformSupported(account.platform);
      }

      const state = await getState();
      // Resolve accounts before importing media, so a missing account fails fast.
      const targets = params.accounts.map((account) => ({
        account,
        accountIds: resolveAccountIds(account, state.accounts),
      }));

      const media = await requestJson<LightPostMediaResponse>(
        "/api/media/url",
        {
          method: "POST",
          body: JSON.stringify({ url: params.videoUrl }),
        },
        "mediaImport"
      );

      const scheduledPosts: PublisherScheduledPost[] = [];
      for (const { account, accountIds } of targets) {
        for (const accountId of accountIds) {
          const hasScheduledAt = !!account.scheduledAt;
          const shouldPostNow = params.autoSchedule === false && !hasScheduledAt;
          const scheduledAt = hasScheduledAt
            ? account.scheduledAt
            : shouldPostNow
              ? undefined
              : getAutoScheduledAt(params.batchIndex, params.batchSize);

          const body = {
            text: account.caption,
            accountIds: [accountId],
            mediaIds: [media.id],
            status: shouldPostNow ? "now" : "scheduled",
            ...(scheduledAt ? { scheduledAt } : {}),
          };

          const post = await requestJson<LightPostCreatePostResponse>("/api/posts", {
            method: "POST",
            body: JSON.stringify(body),
          });

          scheduledPosts.push({
            accountId,
            publisherPostId: post.id,
          });
        }
      }

      const jobId = `lightpost-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      scheduledJobs.set(jobId, scheduledPosts);

      return {
        jobId,
        mediaId: media.id,
      };
    },
    async waitForScheduleJob(jobId: string): Promise<PublisherScheduledPost[]> {
      return scheduledJobs.get(jobId) || [];
    },
    async getPost(postId: string): Promise<PublisherPostStatus | null> {
      const post = await findPostById(postId);
      if (!post) {
        return null;
      }

      const accountId = post.accountIds?.[0];
      const latestByAccount = new Map<string, LightPostResult>();
      for (const result of post.results || []) {
        latestByAccount.set(result.accountId, result);
      }

      const result = accountId ? latestByAccount.get(accountId) : undefined;
      return normalizeState(post, result);
    },
  };
}
