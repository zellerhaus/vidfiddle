import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduled_posts, videos } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import type { Platform, ScheduledPost } from "@/lib/supabase/types";

type RouteParams = { params: Promise<{ id: string }> };

interface RepostRequest {
  platforms: Platform[];
  captions?: Record<Platform, string>;
  scheduled_at?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: scheduledPostId } = await params;

    if (!scheduledPostId) {
      return NextResponse.json(
        { error: "Scheduled post ID is required" },
        { status: 400 }
      );
    }

    const publisher = getPublisher();
    if (!publisher) {
      return NextResponse.json(
        { error: NO_PUBLISHER_CONFIG_MESSAGE },
        { status: 503 }
      );
    }

    const body: RepostRequest = await request.json();
    const { platforms, captions, scheduled_at } = body;

    if (!platforms || platforms.length === 0) {
      return NextResponse.json(
        { error: "At least one platform is required" },
        { status: 400 }
      );
    }

    // Fetch the original scheduled post with its video
    let originalPost;
    try {
      const [row] = await db
        .select({
          post: scheduled_posts,
          videos: {
            id: videos.id,
            video_url: videos.video_url,
            script: videos.script,
            generated_captions: videos.generated_captions,
          },
        })
        .from(scheduled_posts)
        .leftJoin(videos, eq(videos.id, scheduled_posts.video_id))
        .where(eq(scheduled_posts.id, scheduledPostId))
        .limit(1);

      originalPost = row
        ? {
            ...row.post,
            videos: row.videos,
          }
        : null;
    } catch (postError) {
      console.error("Error fetching scheduled post:", postError);
      return NextResponse.json(
        { error: "Scheduled post not found" },
        { status: 404 }
      );
    }

    if (!originalPost) {
      console.error("Error fetching scheduled post:", null);
      return NextResponse.json(
        { error: "Scheduled post not found" },
        { status: 404 }
      );
    }

    const video = originalPost.videos;

    if (!video || !video.video_url) {
      return NextResponse.json(
        { error: "Video not found or video URL not available" },
        { status: 400 }
      );
    }

    // Get available Publer accounts
    const accounts = await publisher.getAccounts();

    // Match requested platforms with available accounts
    const postsToSchedule: Array<{
      platform: Platform;
      accountId: string;
      caption: string;
    }> = [];

    for (const platform of platforms) {
      // Find an account for this platform
      const account = accounts.find(
        (acc) => acc.platform?.toLowerCase() === platform.toLowerCase()
      );

      if (account) {
        // Get caption for this platform:
        // 1. Use provided caption if available
        // 2. Fall back to original post's caption if same platform
        // 3. Fall back to video's generated captions
        // 4. Fall back to video script
        let caption: string;

        if (captions && captions[platform]) {
          caption = captions[platform];
        } else if (originalPost.platform === platform) {
          caption = originalPost.caption;
        } else {
          const generatedCaptions = video.generated_captions as Record<
            string,
            string
          > | null;
          caption = generatedCaptions?.[platform] || video.script || "";
        }

        postsToSchedule.push({
          platform,
          accountId: account.id,
          caption,
        });
      }
    }

    if (postsToSchedule.length === 0) {
      return NextResponse.json(
        { error: "No matching Publer accounts found for requested platforms" },
        { status: 400 }
      );
    }

    // Schedule via Publer
    const { jobId } = await publisher.scheduleVideoPost({
      videoUrl: video.video_url,
      accounts: postsToSchedule,
      autoSchedule: !scheduled_at, // Use auto-schedule if no specific time provided
    });

    // Wait for Publer to create the actual posts and get their IDs
    const publisherPosts = await publisher.waitForScheduleJob(jobId);

    // Create scheduled_posts records with is_repost=true and original_post_id
    const scheduledPostsData = postsToSchedule.map((post) => {
      const match = publisherPosts.find((p) => p.accountId === post.accountId);
      return {
        video_id: video.id,
        platform: post.platform,
        caption: post.caption,
        // Stores the active publisher's post ID (Publer or LightPost).
        publer_post_id: match?.publisherPostId ?? null,
        status: "scheduled" as const,
        scheduled_at: scheduled_at || null,
        is_repost: true,
        original_post_id: scheduledPostId,
      };
    });

    let scheduledPosts: ScheduledPost[] = [];
    try {
      scheduledPosts = await db
        .insert(scheduled_posts)
        .values(scheduledPostsData)
        .returning();
    } catch (insertError) {
      console.error("Error creating repost scheduled posts:", insertError);
      // Don't fail - the Publer job is already created
    }

    return NextResponse.json({
      success: true,
      message: "Repost scheduled successfully",
      publerJobId: jobId,
      scheduledPlatforms: postsToSchedule.map((p) => p.platform),
      scheduledPosts: scheduledPosts || [],
    });
  } catch (error) {
    console.error("Error scheduling repost:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to schedule repost", details: errorMessage },
      { status: 500 }
    );
  }
}
