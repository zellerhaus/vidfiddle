import { AppLayout, Header } from "@/components/layout";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { youtube_sources } from "@/db/schema";
import { YouTubeSourceList } from "./youtube-source-list";

async function getYouTubeSources() {
  try {
    const data = await db
      .select()
      .from(youtube_sources)
      .orderBy(desc(youtube_sources.created_at));

    return data;
  } catch (error) {
    console.error("Error fetching YouTube sources:", error);
    return [];
  }
}

export default async function YouTubePage() {
  const sources = await getYouTubeSources();

  return (
    <AppLayout>
      <Header
        title="YouTube Clips"
        description="Turn YouTube videos into viral short-form clips with styled captions"
      />
      <div className="flex-1 overflow-auto p-12">
        <YouTubeSourceList initialSources={sources} />
      </div>
    </AppLayout>
  );
}
