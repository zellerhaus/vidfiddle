import { AppLayout, Header } from "@/components/layout";
import { CalendarContent, CalendarEvent } from "@/components/calendar";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, scheduled_posts, videos } from "@/db/schema";
import type { ScheduledPost } from "@/lib/supabase/types";

interface ScheduledPostWithVideo extends ScheduledPost {
  videos: {
    blog_posts: {
      title: string;
    };
  };
}

async function getCalendarEvents(): Promise<CalendarEvent[]> {
  let scheduledPosts: ScheduledPostWithVideo[];

  try {
    // Fetch scheduled posts with related video and blog post data
    const rows = await db
      .select({
        scheduled_post: scheduled_posts,
        blog_post_title: blog_posts.title,
      })
      .from(scheduled_posts)
      .innerJoin(videos, eq(scheduled_posts.video_id, videos.id))
      .innerJoin(blog_posts, eq(videos.blog_post_id, blog_posts.id))
      .orderBy(asc(scheduled_posts.scheduled_at));

    scheduledPosts = rows.map((row) => ({
      ...row.scheduled_post,
      videos: {
        blog_posts: {
          title: row.blog_post_title,
        },
      },
    }));
  } catch (error) {
    console.error("Error fetching scheduled posts:", error);
    return [];
  }

  // Transform scheduled posts into calendar events
  const events: CalendarEvent[] = scheduledPosts
    .filter((post) => post.scheduled_at || post.published_at)
    .map((post) => {
      const eventDate = post.published_at
        ? new Date(post.published_at)
        : post.scheduled_at
          ? new Date(post.scheduled_at)
          : new Date();

      const title = post.videos?.blog_posts?.title || "Untitled Video";

      return {
        id: post.id,
        title,
        platform: post.platform,
        date: eventDate,
        status: post.status,
        scheduledPost: post,
      };
    });

  return events;
}

export default async function CalendarPage() {
  const events = await getCalendarEvents();

  return (
    <AppLayout>
      <Header
        title="Content Calendar"
        description="View your scheduled and published content"
      />
      <div className="flex-1 overflow-auto p-12">
        <CalendarContent initialEvents={events} />
      </div>
    </AppLayout>
  );
}
