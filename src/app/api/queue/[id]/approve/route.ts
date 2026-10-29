import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds, scheduled_posts, videos } from "@/db/schema";
import { getPublisher } from "@/lib/publishers";
import type { Platform } from "@/lib/supabase/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: videoId } = await params;

    if (!videoId) {
      return NextResponse.json(
        { error: "Video ID is required" },
        { status: 400 }
      );
    }

    // Fetch the video with blog post and feed to get auto_platforms
    const [video] = await db
      .select({
        video: videos,
        blog_posts: { id: blog_posts.id, feed_id: blog_posts.feed_id },
        rss_feeds: { id: rss_feeds.id, auto_platforms: rss_feeds.auto_platforms },
      })
      .from(videos)
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .leftJoin(rss_feeds, eq(blog_posts.feed_id, rss_feeds.id))
      .where(eq(videos.id, videoId))
      .limit(1)
      .then((rows) => rows.map(({ video, blog_posts, rss_feeds }) => ({
        ...video,
        blog_posts: { ...blog_posts, rss_feeds },
      })))
      .catch((videoError) => {
        console.error("Error fetching video:", videoError);
        return [];
      });

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Check video has a video URL
    if (!video.video_url) {
      return NextResponse.json(
        { error: "Video URL not available yet" },
        { status: 400 }
      );
    }

    // Check if video is pending review
    if (video.approval_status !== "pending_review") {
      return NextResponse.json(
        { error: "Video is not pending review" },
        { status: 400 }
      );
    }

    // Update approval status to approved
    try {
      await db
        .update(videos)
        .set({ approval_status: "approved" })
        .where(eq(videos.id, videoId));
    } catch (updateError) {
      console.error("Error updating approval status:", updateError);
      return NextResponse.json(
        { error: "Failed to update approval status" },
        { status: 500 }
      );
    }

    // Get auto_platforms from the feed configuration
    const feed = video.blog_posts?.rss_feeds;
    const autoPlatforms = (feed?.auto_platforms as Platform[]) || [];
    const publisher = getPublisher();

    // If no platforms configured or Publer not configured, just return success
    if (autoPlatforms.length === 0 || !publisher) {
      return NextResponse.json({
        success: true,
        message: "Video approved",
        scheduledPlatforms: [],
      });
    }

    // Get available Publer accounts to match platforms
    const accounts = await publisher.getAccounts();

    // Match configured platforms with available accounts
    const postsToSchedule: Array<{
      platform: Platform;
      accountId: string;
      caption: string;
    }> = [];

    for (const platform of autoPlatforms) {
      // Find an account for this platform
      const account = accounts.find(
        (acc) => acc.platform?.toLowerCase() === platform.toLowerCase()
      );

      if (account) {
        // Get caption for this platform from generated_captions
        const captions = video.generated_captions as Record<string, string> | null;
        const caption = captions?.[platform] || video.script || "";

        postsToSchedule.push({
          platform,
          accountId: account.id,
          caption,
        });
      }
    }

    if (postsToSchedule.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Video approved but no matching accounts found for platforms",
        scheduledPlatforms: [],
      });
    }

    // Schedule via Publer
    const { jobId } = await publisher.scheduleVideoPost({
      videoUrl: video.video_url,
      accounts: postsToSchedule,
      autoSchedule: true,
    });

    // Wait for Publer to create the actual posts and get their IDs
    const publisherPosts = await publisher.waitForScheduleJob(jobId);

    // Create scheduled_posts records with actual Publer post IDs
    const scheduledPostsData = postsToSchedule.map((post) => {
      const match = publisherPosts.find((p) => p.accountId === post.accountId);
      return {
        video_id: videoId,
        platform: post.platform,
        caption: post.caption,
        // Stores the active publisher's post ID (Publer or LightPost).
        publer_post_id: match?.publisherPostId ?? null,
        status: "scheduled" as const,
      };
    });

    let scheduledPosts: (typeof scheduled_posts.$inferSelect)[] = [];
    try {
      scheduledPosts = await db
        .insert(scheduled_posts)
        .values(scheduledPostsData)
        .returning();
    } catch (insertError) {
      console.error("Error creating scheduled posts:", insertError);
      // Don't fail - the Publer job is already created
    }

    // Update blog post status to "converted"
    await db
      .update(blog_posts)
      .set({ status: "converted" })
      .where(eq(blog_posts.id, video.blog_post_id))
      .catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Video approved and scheduled",
      publerJobId: jobId,
      scheduledPlatforms: postsToSchedule.map((p) => p.platform),
      scheduledPosts: scheduledPosts || [],
    });
  } catch (error) {
    console.error("Error approving video:", error);
    return NextResponse.json(
      { error: "Failed to approve video" },
      { status: 500 }
    );
  }
}
