import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blog_posts, scheduled_posts, settings, videos } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import {
  generateMultipleCaptions,
  isClaudeConfigured,
} from "@/lib/claude";
import type { Platform } from "@/lib/supabase/types";

export const maxDuration = 240; // 4 minutes per video (same as schedule route)

async function getDefaultPlatforms(): Promise<Platform[]> {
  const [data] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "default_platforms"))
    .limit(1);

  return (data?.value as Platform[]) ?? [
    "instagram",
    "tiktok",
    "youtube",
    "linkedin",
  ];
}

// GET: return list of unscheduled video IDs
export async function GET() {
  try {
    const allVideos = await db
      .select({ id: videos.id })
      .from(videos)
      .leftJoin(scheduled_posts, eq(scheduled_posts.video_id, videos.id))
      .where(
        and(
          eq(videos.status, "completed"),
          isNotNull(videos.video_url),
          isNull(scheduled_posts.id)
        )
      );

    const videoIds = (allVideos || [])
      .map((v) => v.id);

    return NextResponse.json({ videoIds });
  } catch (error) {
    console.error("[BulkSchedule] Error fetching unscheduled videos:", error);
    return NextResponse.json(
      { error: "Failed to fetch unscheduled videos" },
      { status: 500 }
    );
  }
}

// POST: schedule a single video by ID
export async function POST(request: NextRequest) {
  try {
    const publisher = getPublisher();
    if (!publisher) {
      return NextResponse.json(
        { error: NO_PUBLISHER_CONFIG_MESSAGE },
        { status: 503 }
      );
    }

    const { videoId, batchIndex = 0, batchSize = 1 } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: "videoId is required" },
        { status: 400 }
      );
    }

    const defaultPlatforms = await getDefaultPlatforms();

    // Fetch the video
    let video;
    try {
      const [row] = await db
        .select({
          video: videos,
          blog_posts: {
            id: blog_posts.id,
            title: blog_posts.title,
          },
        })
        .from(videos)
        .leftJoin(blog_posts, eq(blog_posts.id, videos.blog_post_id))
        .where(eq(videos.id, videoId))
        .limit(1);

      video = row
        ? {
            ...row.video,
            blog_posts: row.blog_posts,
          }
        : null;
    } catch {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Fetch Publer accounts
    const accounts = await publisher.getAccounts();

    // Match default platforms to accounts
    const platformAccounts = new Map<Platform, string>();
    for (const platform of defaultPlatforms) {
      const account = accounts.find(
        (acc) => acc.platform?.toLowerCase() === platform.toLowerCase()
      );
      if (account) {
        platformAccounts.set(platform, account.id);
      }
    }

    if (platformAccounts.size === 0) {
      return NextResponse.json(
        { error: "No Publer accounts match the default platforms" },
        { status: 400 }
      );
    }

    // Verify video URL is accessible
    let videoUrl: string | null = null;
    const candidateUrls = [video.video_url, video.creatify_video_url].filter(
      Boolean
    ) as string[];

    for (const url of candidateUrls) {
      try {
        const headRes = await fetch(url, { method: "HEAD" });
        if (headRes.ok) {
          videoUrl = url;
          break;
        }
      } catch {
        // Try next URL
      }
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: "Video URL not accessible" },
        { status: 400 }
      );
    }

    // Generate captions if missing
    const existingCaptions =
      (video.generated_captions as Record<string, string>) || {};
    const missingPlatforms = [...platformAccounts.keys()].filter(
      (p) => !existingCaptions[p]
    );

    let captions = existingCaptions;

    if (missingPlatforms.length > 0 && video.script) {
      if (!isClaudeConfigured()) {
        return NextResponse.json(
          { error: "Claude API is not configured (needed for caption generation)" },
          { status: 503 }
        );
      }

      const captionResults = await generateMultipleCaptions(
        video.script,
        missingPlatforms
      );
      const newCaptions: Record<string, string> = {};
      for (const [platform, result] of Object.entries(captionResults)) {
        newCaptions[platform] = result.caption;
      }
      captions = { ...existingCaptions, ...newCaptions };

      try {
        await db
          .update(videos)
          .set({ generated_captions: captions })
          .where(eq(videos.id, video.id));
      } catch {
        // Ignore update errors to match previous behavior
      }
    }

    // Build posts array
    const postsToSchedule: Array<{
      accountId: string;
      platform: Platform;
      caption: string;
      title?: string;
    }> = [];

    for (const [platform, accountId] of platformAccounts) {
      postsToSchedule.push({
        accountId,
        platform,
        caption: captions[platform] || video.script || "",
        title: video.blog_posts?.title || "",
      });
    }

    // Schedule via Publer
    const { jobId } = await publisher.scheduleVideoPost({
      videoUrl,
      accounts: postsToSchedule,
      autoSchedule: true,
      batchIndex,
      batchSize,
    });

    console.log(
      `[BulkSchedule] Scheduled video ${video.id}, Publer job: ${jobId}`
    );

    // Wait for Publer to create the actual posts and get their IDs
    const publisherPosts = await publisher.waitForScheduleJob(jobId);

    // Create scheduled_posts records with actual Publer post IDs
    const scheduledPostsData = postsToSchedule.map((post) => {
      const match = publisherPosts.find((p) => p.accountId === post.accountId);
      return {
        video_id: video.id,
        platform: post.platform,
        caption: post.caption,
        // Stores the active publisher's post ID (Publer or LightPost).
        publer_post_id: match?.publisherPostId ?? null,
        status: "scheduled" as const,
      };
    });

    try {
      await db.insert(scheduled_posts).values(scheduledPostsData);
    } catch (insertError) {
      console.error(
        `[BulkSchedule] Error creating scheduled posts for ${video.id}:`,
        insertError
      );
    }

    // Update blog post status
    if (video.blog_post_id) {
      try {
        await db
          .update(blog_posts)
          .set({ status: "converted" })
          .where(eq(blog_posts.id, video.blog_post_id));
      } catch {
        // Ignore update errors to match previous behavior
      }
    }

    return NextResponse.json({
      success: true,
      videoId: video.id,
      platforms: postsToSchedule.map((p) => p.platform),
    });
  } catch (error) {
    console.error("[BulkSchedule] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to schedule video" },
      { status: 500 }
    );
  }
}
