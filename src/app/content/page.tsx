import Link from "next/link";
import { AppLayout, Header } from "@/components/layout";
import { ContentList } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds } from "@/db/schema";
import type { BlogPostWithFeed, ContentStatus } from "@/lib/supabase/types";

async function getContent(status?: ContentStatus): Promise<BlogPostWithFeed[]> {
  try {
    const rows = await db
      .select()
      .from(blog_posts)
      .leftJoin(rss_feeds, eq(blog_posts.feed_id, rss_feeds.id))
      .where(status ? eq(blog_posts.status, status) : undefined)
      .orderBy(desc(blog_posts.created_at));

    return rows.map((row) => ({
      ...row.blog_posts,
      rss_feeds: row.rss_feeds,
    }));
  } catch (error) {
    console.error("Error fetching content:", error);
    return [];
  }
}

export default async function ContentPage() {
  const newPosts = await getContent("new");
  const convertingPosts = await getContent("converting");
  const convertedPosts = await getContent("converted");

  return (
    <AppLayout>
      <Header
        title="Content"
        description="Blog posts ready to convert into videos"
        actions={
          <Link href="/content/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add URL
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-12">
        <Tabs defaultValue="new" className="space-y-4">
          <TabsList>
            <TabsTrigger value="new">
              New ({newPosts.length})
            </TabsTrigger>
            <TabsTrigger value="converting">
              Converting ({convertingPosts.length})
            </TabsTrigger>
            <TabsTrigger value="converted">
              Converted ({convertedPosts.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="new">
            <ContentList posts={newPosts} selectable />
          </TabsContent>
          <TabsContent value="converting">
            <ContentList posts={convertingPosts} />
          </TabsContent>
          <TabsContent value="converted">
            <ContentList posts={convertedPosts} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
