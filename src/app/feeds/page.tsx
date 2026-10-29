import { AppLayout, Header } from "@/components/layout";
import { AddFeedDialog, FeedList } from "@/components/feeds";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { rss_feeds } from "@/db/schema";

async function getFeeds() {
  try {
    const feeds = await db
      .select()
      .from(rss_feeds)
      .orderBy(desc(rss_feeds.created_at));

    return feeds;
  } catch (error) {
    console.error("Error fetching feeds:", error);
    return [];
  }
}

export default async function FeedsPage() {
  const feeds = await getFeeds();

  return (
    <AppLayout>
      <Header
        title="RSS Feeds"
        description="Manage your RSS feeds for automatic content detection"
        actions={<AddFeedDialog />}
      />
      <div className="flex-1 overflow-auto p-12">
        <FeedList feeds={feeds} />
      </div>
    </AppLayout>
  );
}
