import { AppLayout, Header } from "@/components/layout";
import { QueueContent } from "@/components/queue";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import type { VideoWithPostAndScheduled } from "@/lib/supabase/types";

async function getPendingReviewVideos(): Promise<VideoWithPostAndScheduled[]> {
  try {
    const rows = await db
      .select()
      .from(videos)
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .leftJoin(scheduled_posts, eq(scheduled_posts.video_id, videos.id))
      .where(
        and(
          eq(videos.auto_generated, true),
          eq(videos.approval_status, "pending_review")
        )
      )
      .orderBy(desc(videos.created_at));

    const videosById = new Map<string, VideoWithPostAndScheduled>();

    for (const row of rows) {
      const video = videosById.get(row.videos.id);

      if (video) {
        if (row.scheduled_posts) {
          video.scheduled_posts.push(row.scheduled_posts);
        }
        continue;
      }

      videosById.set(row.videos.id, {
        ...row.videos,
        blog_posts: row.blog_posts,
        scheduled_posts: row.scheduled_posts ? [row.scheduled_posts] : [],
      });
    }

    return Array.from(videosById.values());
  } catch (error) {
    console.error("Error fetching pending review videos:", error);
    return [];
  }
}

export default async function QueuePage() {
  const videos = await getPendingReviewVideos();

  return (
    <AppLayout>
      <Header
        title="Approval Queue"
        description="Review auto-generated videos before publishing"
      />
      <div className="flex-1 overflow-auto p-12">
        <QueueContent initialVideos={videos} />
      </div>
    </AppLayout>
  );
}
