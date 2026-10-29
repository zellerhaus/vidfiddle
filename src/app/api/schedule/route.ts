import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import type { Platform } from "@/lib/supabase/types";

export const maxDuration = 240; // 4 minutes — video uploads to Publer can be slow

export async function GET() {
  // Return available publisher accounts
  try {
    const publisher = getPublisher();
    if (!publisher) {
      return NextResponse.json(
        { error: NO_PUBLISHER_CONFIG_MESSAGE },
        { status: 503 }
      );
    }

    const accounts = await publisher.getAccounts();

    // Map to the expected client format (getAccounts already normalizes platform names)
    const clientAccounts = accounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      platform: acc.platform,
      avatar: acc.avatar_url,
    }));

    console.log("[Schedule] Returning accounts to client:", JSON.stringify(clientAccounts, null, 2));

    return NextResponse.json({ accounts: clientAccounts });
  } catch (error) {
    console.error("Error fetching publisher accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch publisher accounts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const publisher = getPublisher();
    if (!publisher) {
      return NextResponse.json(
        { error: NO_PUBLISHER_CONFIG_MESSAGE },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { videoId, posts } = body as {
      videoId: string;
      posts: Array<{
        platform: Platform;
        accountId: string;
        caption: string;
      }>;
    };

    if (!videoId || !posts || posts.length === 0) {
      return NextResponse.json(
        { error: "Video ID and posts are required" },
        { status: 400 }
      );
    }

    // Fetch the video to get the video URL
    let video;
    try {
      [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);
    } catch {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Pick the best accessible video URL
    // Prefer our stored URL (permanent/public) over S3 Remotion URLs (may expire)
    const candidateUrls = [
      video.video_url,
      video.creatify_video_url,
    ].filter(Boolean) as string[];

    if (candidateUrls.length === 0) {
      return NextResponse.json(
        { error: "Video URL not available yet" },
        { status: 400 }
      );
    }

    // Verify the URL is accessible before sending to Publer
    let videoUrl: string | null = null;
    for (const url of candidateUrls) {
      try {
        const headRes = await fetch(url, { method: "HEAD" });
        if (headRes.ok) {
          videoUrl = url;
          console.log("[Schedule] Verified accessible video URL:", url);
          break;
        }
        console.log(`[Schedule] URL not accessible (${headRes.status}):`, url);
      } catch (err) {
        console.log("[Schedule] URL fetch error:", url, err);
      }
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: "Video URL is not accessible. The video file may have expired." },
        { status: 400 }
      );
    }

    // Schedule via Publer
    console.log("[Schedule] Scheduling video to Publer:", {
      videoId,
      videoUrl,
      platforms: posts.map((p) => p.platform),
      accountIds: posts.map((p) => p.accountId),
    });

    // Fetch blog post title for YouTube video title
    let blogPost;
    try {
      [blogPost] = await db
        .select({ title: blog_posts.title })
        .from(blog_posts)
        .where(eq(blog_posts.id, video.blog_post_id))
        .limit(1);
    } catch {
      blogPost = null;
    }

    const blogTitle = blogPost?.title || "";

    const { jobId } = await publisher.scheduleVideoPost({
      videoUrl,
      accounts: posts.map((post) => ({
        accountId: post.accountId,
        platform: post.platform,
        caption: post.caption,
        title: blogTitle,
      })),
      autoSchedule: true,
    });

    console.log("[Schedule] Publer job created successfully:", { jobId });

    // Wait for Publer to create the actual posts and get their IDs
    const publisherPosts = await publisher.waitForScheduleJob(jobId);

    // Create scheduled_posts records with actual Publer post IDs
    const scheduledPostsData = posts.map((post) => {
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
    try {
      await db
        .update(blog_posts)
        .set({ status: "converted" })
        .where(eq(blog_posts.id, video.blog_post_id));
    } catch {
      // Ignore update errors to match previous behavior
    }

    return NextResponse.json({
      success: true,
      publerJobId: jobId,
      scheduledPosts: scheduledPosts || [],
    });
  } catch (error) {
    console.error("Error scheduling posts:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to schedule posts", details: errorMessage },
      { status: 500 }
    );
  }
}
