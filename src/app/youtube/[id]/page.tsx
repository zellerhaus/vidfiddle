import { AppLayout, Header } from "@/components/layout";
import { ProcessingStatus, ClipCard } from "@/components/youtube";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { youtube_clips, youtube_sources } from "@/db/schema";

async function getSourceWithClips(id: string) {
  try {
    const [source] = await db
      .select()
      .from(youtube_sources)
      .where(eq(youtube_sources.id, id))
      .limit(1);

    if (!source) return null;

    try {
      const clips = await db
        .select()
        .from(youtube_clips)
        .where(eq(youtube_clips.youtube_source_id, id))
        .orderBy(asc(youtube_clips.clip_index));

      return { source, clips };
    } catch {
      return { source, clips: [] };
    }
  } catch {
    return null;
  }
}

export default async function YouTubeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getSourceWithClips(id);

  if (!data) {
    notFound();
  }

  const { source, clips } = data;

  return (
    <AppLayout>
      <Header
        title={source.title || "Processing Video..."}
        description={source.youtube_url}
      />
      <div className="flex-1 overflow-auto p-12">
        <div className="max-w-3xl space-y-8">
          {/* Processing Status */}
          <ProcessingStatus sourceId={source.id} pipeline={source.submagic_project_id ? "submagic" : "legacy"} />

          {/* Clips */}
          {clips.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">
                Detected Clips ({clips.length})
              </h2>
              {clips.map((clip) => (
                <ClipCard key={clip.id} clip={clip} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
