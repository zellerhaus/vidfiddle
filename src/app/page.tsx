import { AppLayout, Header } from "@/components/layout";
import { StatsCards, RecentActivity, QuickActions, ProcessingActions, ReadyToSchedule, CreatifyCredits } from "@/components/dashboard";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, generation_queue, scheduled_posts, videos } from "@/db/schema";
import { isCreatifyConfigured } from "@/lib/creatify";
import type { VideoWithPost } from "@/lib/supabase/types";

async function getDashboardData() {
  // Fetch all stats in parallel for better performance
  const [
    pendingContent,
    videosInProgress,
    scheduledPosts,
    totalVideos,
    recentVideoRows,
    autoQueuePending,
    readyToScheduleRows,
  ] = await Promise.all([
    // Pending Content: blog_posts where status='new'
    db.$count(blog_posts, eq(blog_posts.status, "new")),

    // Videos In Progress: videos where status IN ('pending', 'generating')
    db.$count(videos, inArray(videos.status, ["pending", "generating"])),

    // Scheduled Posts: scheduled_posts where status='scheduled'
    db.$count(scheduled_posts, eq(scheduled_posts.status, "scheduled")),

    // Total Videos: count all videos
    db.$count(videos),

    // Recent Videos: last 5 videos with blog_post join
    db
      .select()
      .from(videos)
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .orderBy(desc(videos.created_at))
      .limit(5),

    // Auto Queue: pending items in generation_queue
    db.$count(
      generation_queue,
      inArray(generation_queue.status, ["pending", "processing"])
    ),

    // Ready to schedule: completed videos with no scheduled posts
    db
      .select({
        id: videos.id,
        scheduled_post_id: scheduled_posts.id,
      })
      .from(videos)
      .leftJoin(scheduled_posts, eq(scheduled_posts.video_id, videos.id))
      .where(
        and(
          eq(videos.status, "completed"),
          isNotNull(videos.video_url)
        )
      ),
  ]);

  const readyToScheduleCount = readyToScheduleRows.filter(
    (video) => !video.scheduled_post_id
  ).length;

  return {
    stats: {
      pendingContent,
      videosInProgress,
      scheduledPosts,
      totalVideos,
      autoQueuePending,
    },
    recentVideos: recentVideoRows.map((row) => ({
      ...row.videos,
      blog_posts: row.blog_posts,
    })) satisfies VideoWithPost[],
    readyToSchedule: readyToScheduleCount,
  };
}

export default async function DashboardPage() {
  const { stats, recentVideos, readyToSchedule } = await getDashboardData();

  return (
    <AppLayout>
      <Header
        title="Dashboard"
        description="Overview of your video generation pipeline"
      />
      <div className="flex-1 overflow-auto p-12">
        <div className="space-y-8">
          {isCreatifyConfigured() && <CreatifyCredits />}
          <ReadyToSchedule count={readyToSchedule} />
          <StatsCards
            pendingContent={stats.pendingContent}
            videosInProgress={stats.videosInProgress}
            scheduledPosts={stats.scheduledPosts}
            totalVideos={stats.totalVideos}
            autoQueuePending={stats.autoQueuePending}
          />

          <div className="grid gap-8 md:grid-cols-3">
            <RecentActivity videos={recentVideos} />
            <QuickActions />
            <ProcessingActions />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
