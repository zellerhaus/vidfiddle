import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import type { Platform } from "@/lib/supabase/types";

export const maxDuration = 240;

type RouteParams = { params: Promise<{ id: string }> };

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

    // Fetch the scheduled post with its video
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
          blog_post_id: videos.blog_post_id,
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
                  blog_post_id: row.blog_post_id,
                  blog_posts:
                    row.blogTitle !== null ? { title: row.blogTitle } : null,
                }
              : null,
          }
        : null;
    } catch (postError) {
      console.error("Error fetching scheduled post:", postError);
      return NextResponse.json(
        { error: "Scheduled post not found" },
        { status: 404 }
      );
    }

    if (!post) {
      console.error("Error fetching scheduled post:", null);
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
        { error: "Video URL not accessible. The video file may have expired." },
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

    console.log(
      `[Reschedule] Rescheduled post ${scheduledPostId}, Publer job: ${jobId}`
    );

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
      console.error("Error updating scheduled post:", updateError);
      return NextResponse.json(
        { error: "Failed to update scheduled post record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Post rescheduled successfully",
      publerJobId: jobId,
      publerPostId: match?.publisherPostId ?? null,
    });
  } catch (error) {
    console.error("Error rescheduling post:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to reschedule post", details: errorMessage },
      { status: 500 }
    );
  }
}
