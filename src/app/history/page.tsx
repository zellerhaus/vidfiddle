import { AppLayout, Header } from "@/components/layout";
import { VideoList } from "@/components/history/video-list";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import type { VideoWithPostAndScheduled } from "@/lib/supabase/types";

async function getVideoHistory(): Promise<VideoWithPostAndScheduled[]> {
  try {
    const rows = await db
      .select()
      .from(videos)
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .leftJoin(scheduled_posts, eq(scheduled_posts.video_id, videos.id))
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
    console.error("Error fetching video history:", error);
    return [];
  }
}

export default async function HistoryPage() {
  const videos = await getVideoHistory();

  return (
    <AppLayout>
      <Header title="History" description="All videos you've created" />
      <div className="flex-1 overflow-auto p-12">
        <VideoList initialVideos={videos} />
      </div>
    </AppLayout>
  );
}
