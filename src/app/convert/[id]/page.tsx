import { notFound } from "next/navigation";
import { AppLayout, Header } from "@/components/layout";
import { ConversionWizard } from "@/components/convert/conversion-wizard";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, content_segments, videos } from "@/db/schema";
import type { BlogPost, Video, ContentSegment } from "@/lib/supabase/types";

async function getBlogPost(id: string): Promise<BlogPost | null> {
  try {
    const [data] = await db
      .select()
      .from(blog_posts)
      .where(eq(blog_posts.id, id))
      .limit(1);

    if (!data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error fetching blog post:", error);
    return null;
  }
}

async function getExistingVideo(blogPostId: string, segmentId?: string): Promise<Video | null> {
  try {
    // Get the most recent video for this blog post (and segment if provided)
    const [data] = await db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.blog_post_id, blogPostId),
          segmentId ? eq(videos.content_segment_id, segmentId) : undefined
        )
      )
      .orderBy(desc(videos.created_at))
      .limit(1);

    if (!data) {
      // No existing video is fine
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

async function getSegment(segmentId: string): Promise<ContentSegment | null> {
  try {
    const [data] = await db
      .select()
      .from(content_segments)
      .where(eq(content_segments.id, segmentId))
      .limit(1);

    if (!data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error fetching segment:", error);
    return null;
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segments?: string }>;
}

export default async function ConvertPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { segments } = await searchParams;

  // Parse segment IDs from query string (comma-separated)
  const segmentIds = segments ? segments.split(",").filter(Boolean) : [];
  const currentSegmentId = segmentIds[0]; // Start with first segment

  const [post, segment, existingVideo] = await Promise.all([
    getBlogPost(id),
    currentSegmentId ? getSegment(currentSegmentId) : Promise.resolve(null),
    getExistingVideo(id, currentSegmentId),
  ]);

  if (!post) {
    notFound();
  }

  // Build description showing segment info if applicable
  const description = segment
    ? `${post.title} - Video ${(segment.segment_index ?? 0) + 1}: ${segment.title}`
    : post.title;

  return (
    <AppLayout>
      <Header
        title="Convert to Video"
        description={description}
      />
      <div className="flex-1 overflow-auto">
        <ConversionWizard
          post={post}
          existingVideo={existingVideo}
          segment={segment}
        />
      </div>
    </AppLayout>
  );
}
