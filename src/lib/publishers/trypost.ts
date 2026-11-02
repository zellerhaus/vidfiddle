import type { Platform } from "@/lib/supabase/types";
import { autoScheduledAt, errorMessageFromBody, videoTitle } from "./shared";
import type {
  Publisher,
  PublisherAccount,
  PublisherPostStatus,
  PublisherScheduleAccount,
  PublisherScheduleParams,
  PublisherScheduledPost,
} from "./types";

// TryPost REST API: https://docs.trypost.it/api-reference/introduction
// Cloud lives at app.trypost.it/api; a self-hosted install serves it at its APP_URL + /api.
const TRYPOST_CLOUD_URL = "https://app.trypost.it";
const CONFLICT_RETRIES = 3;

interface TryPostSocialAccount {
  id: string;
  platform: string;
  display_name?: string | null;
  username?: string | null;
  status: string;
  has_posting_schedule?: boolean;
}

interface TryPostPage<T> {
  data: T[];
  meta?: { current_page?: number; last_page?: number };
}

interface TryPostTikTokCreatorInfo {
  can_post?: boolean;
  privacy_level_options?: string[];
}

interface TryPostPost {
  id: string;
  status: string;
  publish_status?: string;
  scheduled_at?: string | null;
  published_at?: string | null;
  platform_url?: string | null;
  error_message?: string | null;
  media?: Array<{ id: string }> | null;
}

const TRYPOST_TO_APP_PLATFORM: Record<string, Platform> = {
  instagram: "instagram",
  "instagram-facebook": "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  "linkedin-page": "linkedin",
  x: "twitter",
  youtube: "youtube",
  tiktok: "tiktok",
};

// Formats that take one video at any aspect ratio. A single-video instagram_feed post
// publishes as a Reel; YouTube only offers Shorts.
const VIDEO_CONTENT_TYPE: Record<string, string> = {
  instagram: "instagram_feed",
  "instagram-facebook": "instagram_feed",
  facebook: "facebook_post",
  linkedin: "linkedin_post",
  "linkedin-page": "linkedin_page_post",
  x: "x_post",
  youtube: "youtube_short",
  tiktok: "tiktok_video",
};

function trypostApiBase(): string {
  const raw = (process.env.TRYPOST_URL || TRYPOST_CLOUD_URL).trim().replace(/\/+$/, "");
  return raw.endsWith("/api") ? raw : `${raw}/api`;
}

// TryPost timestamps are UTC "Y-m-d H:i:s".
function toIso(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizePost(post: TryPostPost): PublisherPostStatus {
  if (post.status === "published" || post.publish_status === "published") {
    return {
      id: post.id,
      state: "published",
      published_at: toIso(post.published_at),
      post_link: post.platform_url || undefined,
    };
  }

  if (post.status === "failed" || post.publish_status === "failed" || post.publish_status === "rejected") {
    return {
      id: post.id,
      state: "failed",
      scheduled_at: toIso(post.scheduled_at),
      error: post.error_message || "TryPost couldn't publish this post",
    };
  }

  // draft, pending_approval, scheduled, publishing or retrying: not published yet.
  return {
    id: post.id,
    state: "scheduled",
    scheduled_at: toIso(post.scheduled_at),
  };
}

export function isTryPostConfigured(): boolean {
  return !!process.env.TRYPOST_API_KEY;
}

export function createTryPostPublisher(): Publisher {
  const baseUrl = trypostApiBase();
  const apiKey = process.env.TRYPOST_API_KEY || "";
  const scheduledJobs = new Map<string, PublisherScheduledPost[]>();

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!apiKey) {
      throw new Error("TRYPOST_API_KEY is required for TryPost publishing.");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    // 409 means another change to the same post or channel queue is running: retry.
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      if (response.status !== 409 || attempt >= CONFLICT_RETRIES) {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  async function failure(response: Response, context: "generic" | "createPost" = "generic"): Promise<Error> {
    const rawBody = await response.text();
    const message = errorMessageFromBody(rawBody, `TryPost request failed (${response.status})`);

    if (response.status === 401) {
      return new Error(`TryPost rejected TRYPOST_API_KEY: ${message}`);
    }
    if (response.status === 403) {
      return new Error(`${message} The TryPost API key must belong to a workspace admin.`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      return new Error(`TryPost rate limit reached${retryAfter ? `; retry in ${retryAfter} seconds` : ""}.`);
    }
    if (context === "createPost" && response.status === 422 && /"media/.test(rawBody)) {
      return new Error(
        `${message} TryPost downloads the video from PUBLIC_URL, which must be a public address serving the file itself.`
      );
    }

    return new Error(`TryPost: ${message}`);
  }

  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await request(path, init);
    if (!response.ok) {
      throw await failure(response);
    }
    return response.json() as Promise<T>;
  }

  async function listSocialAccounts(): Promise<TryPostSocialAccount[]> {
    const accounts: TryPostSocialAccount[] = [];
    for (let page = 1; page <= 50; page++) {
      const response = await requestJson<TryPostPage<TryPostSocialAccount>>(`/social-accounts?page=${page}`);
      accounts.push(...(response.data || []));
      const lastPage = response.meta?.last_page ?? page;
      if (page >= lastPage || (response.data || []).length === 0) {
        break;
      }
    }
    return accounts;
  }

  function resolveAccount(
    account: PublisherScheduleAccount,
    socialAccounts: TryPostSocialAccount[]
  ): TryPostSocialAccount {
    const match = account.accountId
      ? socialAccounts.find((item) => item.id === account.accountId)
      : socialAccounts.find(
          (item) => item.status === "connected" && TRYPOST_TO_APP_PLATFORM[item.platform] === account.platform
        );

    if (!match) {
      throw new Error(
        account.accountId
          ? `TryPost has no channel ${account.accountId} (for ${account.platform}).`
          : `No TryPost channel is connected for platform: ${account.platform}`
      );
    }
    if (match.status !== "connected") {
      throw new Error(
        `The TryPost channel ${match.display_name || match.id} is ${match.status.replace("_", " ")}. Reconnect it in TryPost.`
      );
    }
    if (!VIDEO_CONTENT_TYPE[match.platform]) {
      throw new Error(`Vidfiddle can't post video to TryPost's ${match.platform} channels.`);
    }
    return match;
  }

  // TikTok requires a privacy level the creator is allowed to use right now.
  async function tiktokMeta(socialAccount: TryPostSocialAccount): Promise<Record<string, unknown>> {
    const info = await requestJson<TryPostTikTokCreatorInfo>(
      `/social-accounts/${encodeURIComponent(socialAccount.id)}/tiktok-creator-info`
    );
    if (info.can_post === false) {
      throw new Error(
        `TikTok won't let ${socialAccount.display_name || "this account"} post right now. Try again later.`
      );
    }
    const options = info.privacy_level_options || [];
    const privacyLevel = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0];
    if (!privacyLevel) {
      throw new Error(`TikTok returned no privacy levels for ${socialAccount.display_name || "this account"}.`);
    }
    return { privacy_level: privacyLevel };
  }

  async function createPost(body: Record<string, unknown>): Promise<TryPostPost> {
    const response = await request("/posts", { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) {
      throw await failure(response, "createPost");
    }
    return response.json() as Promise<TryPostPost>;
  }

  return {
    name: "trypost",
    async getAccounts(): Promise<PublisherAccount[]> {
      const socialAccounts = await listSocialAccounts();
      return socialAccounts
        .filter((account) => account.status === "connected" && TRYPOST_TO_APP_PLATFORM[account.platform])
        .map((account) => ({
          id: account.id,
          name: account.display_name || account.username || account.id,
          platform: TRYPOST_TO_APP_PLATFORM[account.platform],
          username: account.username || undefined,
        }));
    },
    async scheduleVideoPost(params: PublisherScheduleParams): Promise<{ jobId: string; mediaId?: string }> {
      const socialAccounts = await listSocialAccounts();
      // Resolve every channel and its required settings first, so nothing is half-posted.
      const targets: Array<{
        account: PublisherScheduleAccount;
        socialAccount: TryPostSocialAccount;
        meta: Record<string, unknown>;
      }> = [];
      for (const account of params.accounts) {
        const socialAccount = resolveAccount(account, socialAccounts);
        const meta: Record<string, unknown> =
          socialAccount.platform === "tiktok"
            ? await tiktokMeta(socialAccount)
            : socialAccount.platform === "youtube"
              ? { title: videoTitle(account.title, account.caption), privacy_status: "public" }
              : {};
        targets.push({ account, socialAccount, meta });
      }

      const scheduledPosts: PublisherScheduledPost[] = [];
      // TryPost downloads the video for the first post; later posts copy that media item.
      let mediaId: string | undefined;

      for (const { account, socialAccount, meta } of targets) {
        let timing: Record<string, unknown>;
        if (account.scheduledAt) {
          timing = { status: "scheduled", scheduled_at: new Date(account.scheduledAt).toISOString() };
        } else if (params.autoSchedule === false) {
          timing = { status: "publishing" };
        } else if (socialAccount.has_posting_schedule) {
          // The channel's next free slot, like Publer's auto-scheduling.
          timing = { status: "scheduled", queue: "next" };
        } else {
          timing = { status: "scheduled", scheduled_at: autoScheduledAt(params.batchIndex, params.batchSize) };
        }

        const post = await createPost({
          content: account.caption,
          media: [mediaId ? { id: mediaId } : { url: params.videoUrl }],
          social_account_id: socialAccount.id,
          content_type: VIDEO_CONTENT_TYPE[socialAccount.platform],
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
          ...timing,
        });

        mediaId ??= post.media?.[0]?.id;
        scheduledPosts.push({ accountId: socialAccount.id, publisherPostId: post.id });
      }

      const jobId = `trypost-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      scheduledJobs.set(jobId, scheduledPosts);

      return { jobId, mediaId };
    },
    async waitForScheduleJob(jobId: string): Promise<PublisherScheduledPost[]> {
      return scheduledJobs.get(jobId) || [];
    },
    async getPost(postId: string): Promise<PublisherPostStatus | null> {
      const response = await request(`/posts/${encodeURIComponent(postId)}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        // Throw rather than return null: verify-publer marks a missing post failed.
        throw await failure(response);
      }
      return normalizePost((await response.json()) as TryPostPost);
    },
  };
}
