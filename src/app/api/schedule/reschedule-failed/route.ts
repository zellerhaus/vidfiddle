import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import type { Platform } from "@/lib/supabase/types";

export const maxDuration = 240;

// GET: return list of failed scheduled posts with video details
export async function GET() {
  try {
    const failedPosts = await db
      .select({
        id: scheduled_posts.id,
        video_id: scheduled_posts.video_id,
        platform: scheduled_posts.platform,
        caption: scheduled_posts.caption,
        status: scheduled_posts.status,
        error_message: scheduled_posts.error_message,
        created_at: scheduled_posts.created_at,
        videoId: videos.id,
        video_url: videos.video_url,
        creatify_video_url: videos.creatify_video_url,
        blogTitle: blog_posts.title,
      })
      .from(scheduled_posts)
      .leftJoin(videos, eq(videos.id, scheduled_posts.video_id))
      .leftJoin(blog_posts, eq(blog_posts.id, videos.blog_post_id))
      .where(eq(scheduled_posts.status, "failed"))
      .orderBy(desc(scheduled_posts.created_at));

    return NextResponse.json({
      failedPosts: (failedPosts || []).map((post) => ({
        id: post.id,
        video_id: post.video_id,
        platform: post.platform,
        caption: post.caption,
        status: post.status,
        error_message: post.error_message,
        created_at: post.created_at,
        videos: post.videoId
          ? {
              id: post.videoId,
              video_url: post.video_url,
              creatify_video_url: post.creatify_video_url,
              blog_posts:
                post.blogTitle !== null ? { title: post.blogTitle } : null,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("[RescheduleFailed] Error fetching failed posts:", error);
    return NextResponse.json(
      { error: "Failed to fetch failed posts" },
      { status: 500 }
    );
  }
}

// POST: reschedule a single failed post
export async function POST(request: NextRequest) {
  try {
    const publisher = getPublisher();
    if (!publisher) {
      return NextResponse.json(
        { error: NO_PUBLISHER_CONFIG_MESSAGE },
        { status: 503 }
      );
    }

    const { scheduledPostId } = await request.json();

    if (!scheduledPostId) {
      return NextResponse.json(
        { error: "scheduledPostId is required" },
        { status: 400 }
      );
    }

    // Fetch the failed post with its video
    let post;
    try {
      const [row] = await db
        .select({
          post: scheduled_posts,
          videoId: videos.id,
          video_url: videos.video_url,
          creatify_video_url: videos.creatify_video_url,
          script: videos.script,
          generated_captions: videos.generated_captions,
          blogTitle: blog_posts.title,
        })
        .from(scheduled_posts)
        .leftJoin(videos, eq(videos.id, scheduled_posts.video_id))
        .leftJoin(blog_posts, eq(blog_posts.id, videos.blog_post_id))
        .where(eq(scheduled_posts.id, scheduledPostId))
        .limit(1);

      post = row
        ? {
            ...row.post,
            videos: row.videoId
              ? {
                  id: row.videoId,
                  video_url: row.video_url,
                  creatify_video_url: row.creatify_video_url,
                  script: row.script,
                  generated_captions: row.generated_captions,
                  blog_posts:
                    row.blogTitle !== null ? { title: row.blogTitle } : null,
                }
              : null,
          }
        : null;
    } catch {
      return NextResponse.json(
        { error: "Scheduled post not found" },
        { status: 404 }
      );
    }

    if (!post) {
      return NextResponse.json(
        { error: "Scheduled post not found" },
        { status: 404 }
      );
    }

    if (post.status !== "failed") {
      return NextResponse.json(
        { error: "Only failed posts can be rescheduled" },
        { status: 400 }
      );
    }

    const video = post.videos;
    if (!video) {
      return NextResponse.json(
        { error: "Video not found" },
        { status: 400 }
      );
    }

    // Verify video URL is accessible
    const candidateUrls = [video.video_url, video.creatify_video_url].filter(
      Boolean
    ) as string[];

    let videoUrl: string | null = null;
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

    // Find the Publer account for this platform
    const accounts = await publisher.getAccounts();
    const account = accounts.find(
      (acc) => acc.platform?.toLowerCase() === post.platform.toLowerCase()
    );

    if (!account) {
      return NextResponse.json(
        { error: `No Publer account found for platform: ${post.platform}` },
        { status: 400 }
      );
    }

    const blogTitle = video.blog_posts?.title || "";

    // Schedule via Publer
    const { jobId } = await publisher.scheduleVideoPost({
      videoUrl,
      accounts: [
        {
          accountId: account.id,
          platform: post.platform as Platform,
          caption: post.caption,
          title: blogTitle,
        },
      ],
      autoSchedule: true,
    });

    // Wait for Publer to create the actual post and get the ID
    const publisherPosts = await publisher.waitForScheduleJob(jobId);
    const match = publisherPosts.find((p) => p.accountId === account.id);

    // Update the existing scheduled_post record
    try {
      await db
        .update(scheduled_posts)
        .set({
          // Stores the active publisher's post ID (Publer or LightPost).
          publer_post_id: match?.publisherPostId ?? null,
          status: "scheduled",
          error_message: null,
        })
        .where(eq(scheduled_posts.id, scheduledPostId));
    } catch (updateError) {
      console.error("[RescheduleFailed] Error updating post:", updateError);
    }

    return NextResponse.json({
      success: true,
      scheduledPostId,
      platform: post.platform,
      publerPostId: match?.publisherPostId ?? null,
    });
  } catch (error) {
    console.error("[RescheduleFailed] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reschedule post",
      },
      { status: 500 }
    );
  }
}
