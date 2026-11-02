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

// Postiz public API: https://docs.postiz.com/public-api/introduction
// Cloud lives at api.postiz.com; a self-hosted install serves it under its backend URL
// (with the official compose file, https://your-postiz/api).
const POSTIZ_CLOUD_URL = "https://api.postiz.com";
const DAY_MS = 24 * 60 * 60 * 1000;
// verify-publer calls getPost once per scheduled post; one listing serves the whole pass.
const POST_LIST_CACHE_MS = 30_000;

interface PostizIntegration {
  id: string;
  name?: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
  profile?: string;
}

interface PostizMedia {
  id: string;
  path: string;
}

interface PostizCreatedPost {
  postId: string;
  integration: string;
}

interface PostizPost {
  id: string;
  publishDate?: string;
  releaseURL?: string | null;
  releaseId?: string | null;
  state: string;
  error?: string | null;
}

const POSTIZ_TO_APP_PLATFORM: Record<string, Platform> = {
  instagram: "instagram",
  "instagram-standalone": "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  "linkedin-page": "linkedin",
  x: "twitter",
  youtube: "youtube",
  tiktok: "tiktok",
};

function postizApiBase(): string {
  const raw = (process.env.POSTIZ_URL || POSTIZ_CLOUD_URL).trim().replace(/\/+$/, "");
  return raw.endsWith("/public/v1") ? raw : `${raw}/public/v1`;
}

// Postiz treats post text as HTML: plain text comes out entity-escaped ("Q&amp;A"), while
// paragraphs are converted back to plain lines. Send each caption line as an escaped <p>.
function toPostizContent(caption: string): string {
  return caption
    .split(/\r?\n/)
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .map((line) => `<p>${line}</p>`)
    .join("");
}

// Provider settings for a single-video post. Postiz overwrites __type with the channel's
// provider, but the remaining fields must match it.
function postizSettings(identifier: string, account: PublisherScheduleAccount): Record<string, unknown> {
  switch (identifier) {
    case "instagram":
    case "instagram-standalone":
      return { __type: identifier, post_type: "post", is_trial_reel: false, collaborators: [] };
    case "youtube":
      return {
        __type: "youtube",
        title: videoTitle(account.title, account.caption),
        type: "public",
        selfDeclaredMadeForKids: "no",
        tags: [],
      };
    case "tiktok":
      return {
        __type: "tiktok",
        privacy_level: "PUBLIC_TO_EVERYONE",
        duet: false,
        stitch: false,
        comment: true,
        autoAddMusic: "no",
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: "DIRECT_POST",
      };
    case "x":
      return { __type: "x", who_can_reply_post: "everyone", community: "" };
    case "linkedin":
    case "linkedin-page":
      return { __type: identifier, post_as_images_carousel: false };
    case "facebook":
      return {
        __type: "facebook",
        post_type: "post",
        ...(account.title?.trim() ? { title: account.title.trim().slice(0, 255) } : {}),
      };
    default:
      return { __type: identifier };
  }
}

function normalizePost(post: PostizPost): PublisherPostStatus {
  if (post.state === "PUBLISHED") {
    return {
      id: post.id,
      state: "published",
      published_at: post.publishDate,
      post_link: post.releaseURL || undefined,
      remote_post_id: post.releaseId || undefined,
    };
  }

  if (post.state === "ERROR") {
    return {
      id: post.id,
      state: "failed",
      scheduled_at: post.publishDate,
      error: post.error || "Postiz couldn't publish this post",
    };
  }

  // QUEUE, or DRAFT if someone moved it back in Postiz: not published yet.
  return {
    id: post.id,
    state: "scheduled",
    scheduled_at: post.publishDate,
  };
}

export function isPostizConfigured(): boolean {
  return !!process.env.POSTIZ_API_KEY;
}

export function createPostizPublisher(): Publisher {
  const baseUrl = postizApiBase();
  const apiKey = process.env.POSTIZ_API_KEY || "";
  const scheduledJobs = new Map<string, PublisherScheduledPost[]>();
  let postListCache: { at: number; posts: PostizPost[] } | null = null;

  async function requestJson<T>(
    path: string,
    init: RequestInit = {},
    context: "generic" | "mediaImport" = "generic"
  ): Promise<T> {
    if (!apiKey) {
      throw new Error("POSTIZ_API_KEY is required for Postiz publishing.");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", apiKey);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });

    if (!response.ok) {
      const message = errorMessageFromBody(await response.text(), `Postiz request failed (${response.status})`);

      if (response.status === 401) {
        throw new Error(`Postiz rejected POSTIZ_API_KEY: ${message}`);
      }
      if (response.status === 429) {
        throw new Error(
          `${message} Postiz limits post creation per hour (API_LIMIT on a self-hosted install).`
        );
      }
      if (response.status === 404 && path === "/integrations") {
        throw new Error(
          `Postiz API not found at ${baseUrl}. For a self-hosted install, set POSTIZ_URL to its backend URL, usually https://your-postiz/api.`
        );
      }
      if (context === "mediaImport") {
        throw new Error(
          `${message} Postiz downloads the video from PUBLIC_URL, which must be a public address: it refuses localhost and private networks unless DISABLE_SSRF_PROTECTION is set on Postiz.`
        );
      }

      throw new Error(`Postiz: ${message}`);
    }

    return response.json() as Promise<T>;
  }

  async function listIntegrations(): Promise<PostizIntegration[]> {
    return requestJson<PostizIntegration[]>("/integrations");
  }

  function resolveIntegration(
    account: PublisherScheduleAccount,
    integrations: PostizIntegration[]
  ): PostizIntegration {
    if (account.accountId) {
      const match = integrations.find((integration) => integration.id === account.accountId);
      if (!match) {
        throw new Error(`Postiz has no channel ${account.accountId} (for ${account.platform}).`);
      }
      if (match.disabled) {
        throw new Error(`The Postiz channel ${match.name || match.id} is disabled. Enable it in Postiz.`);
      }
      return match;
    }

    const match = integrations.find(
      (integration) =>
        !integration.disabled && POSTIZ_TO_APP_PLATFORM[integration.identifier] === account.platform
    );
    if (!match) {
      throw new Error(`No Postiz channel is connected for platform: ${account.platform}`);
    }
    return match;
  }

  // The channel's next free posting slot in Postiz, like Publer's auto-scheduling.
  async function nextFreeSlot(integrationId: string): Promise<string | null> {
    try {
      const { date } = await requestJson<{ date?: string | null }>(
        `/find-slot/${encodeURIComponent(integrationId)}`
      );
      if (date && new Date(date).getTime() > Date.now()) {
        return new Date(date).toISOString();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Postiz] Couldn't find a free slot, using a computed time: ${message}`);
    }
    return null;
  }

  async function listPosts(): Promise<PostizPost[]> {
    if (postListCache && Date.now() - postListCache.at < POST_LIST_CACHE_MS) {
      return postListCache.posts;
    }

    // Postiz has no get-by-id route, only a date-range listing. Look a year back and three
    // years ahead so a post is never reported missing (and marked failed) just for its date.
    const startDate = new Date(Date.now() - 365 * DAY_MS).toISOString();
    const endDate = new Date(Date.now() + 3 * 365 * DAY_MS).toISOString();
    const query = new URLSearchParams({ startDate, endDate });
    const response = await requestJson<{ posts?: PostizPost[] }>(`/posts?${query.toString()}`);

    postListCache = { at: Date.now(), posts: response.posts || [] };
    return postListCache.posts;
  }

  return {
    name: "postiz",
    async getAccounts(): Promise<PublisherAccount[]> {
      const integrations = await listIntegrations();
      return integrations
        .filter((integration) => !integration.disabled && POSTIZ_TO_APP_PLATFORM[integration.identifier])
        .map((integration) => ({
          id: integration.id,
          name: integration.name || integration.profile || integration.id,
          platform: POSTIZ_TO_APP_PLATFORM[integration.identifier],
          avatar_url: integration.picture,
          username: integration.profile,
        }));
    },
    async scheduleVideoPost(params: PublisherScheduleParams): Promise<{ jobId: string; mediaId?: string }> {
      const integrations = await listIntegrations();
      // Resolve channels before uploading, so a missing one fails fast.
      const targets = params.accounts.map((account) => ({
        account,
        integration: resolveIntegration(account, integrations),
      }));

      const media = await requestJson<PostizMedia>(
        "/upload-from-url",
        { method: "POST", body: JSON.stringify({ url: params.videoUrl }) },
        "mediaImport"
      );

      // The public API takes one date per request, so group the channels by when they post.
      let autoDate: string | null = null;
      const groups = new Map<string, { type: "now" | "schedule"; date: string; items: typeof targets }>();
      for (const target of targets) {
        let type: "now" | "schedule" = "schedule";
        let date: string;

        if (target.account.scheduledAt) {
          date = new Date(target.account.scheduledAt).toISOString();
        } else if (params.autoSchedule === false) {
          type = "now";
          date = new Date().toISOString();
        } else {
          autoDate ??=
            (await nextFreeSlot(target.integration.id)) ??
            autoScheduledAt(params.batchIndex, params.batchSize);
          date = autoDate;
        }

        const key = `${type}|${date}`;
        const group = groups.get(key) ?? { type, date, items: [] };
        group.items.push(target);
        groups.set(key, group);
      }

      const scheduledPosts: PublisherScheduledPost[] = [];
      for (const group of groups.values()) {
        const body = {
          type: group.type,
          date: group.date,
          shortLink: false,
          tags: [],
          posts: group.items.map(({ account, integration }) => ({
            integration: { id: integration.id },
            value: [
              {
                content: toPostizContent(account.caption),
                image: [{ id: media.id, path: media.path }],
              },
            ],
            settings: postizSettings(integration.identifier, account),
          })),
        };

        const created = await requestJson<PostizCreatedPost[]>("/posts", {
          method: "POST",
          body: JSON.stringify(body),
        });

        for (const post of created) {
          scheduledPosts.push({ accountId: post.integration, publisherPostId: post.postId });
        }
      }

      postListCache = null;
      const jobId = `postiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      scheduledJobs.set(jobId, scheduledPosts);

      return { jobId, mediaId: media.id };
    },
    async waitForScheduleJob(jobId: string): Promise<PublisherScheduledPost[]> {
      return scheduledJobs.get(jobId) || [];
    },
    async getPost(postId: string): Promise<PublisherPostStatus | null> {
      const posts = await listPosts();
      const post = posts.find((item) => item.id === postId);
      return post ? normalizePost(post) : null;
    },
  };
}
