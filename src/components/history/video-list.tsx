"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Video } from "lucide-react";
import { VideoCard } from "./video-card";
import { BulkScheduleButton } from "./bulk-schedule-button";
import { RescheduleFailedButton } from "./reschedule-failed-button";
import type { VideoWithPostAndScheduled } from "@/lib/supabase/types";

interface VideoListProps {
  initialVideos: VideoWithPostAndScheduled[];
}

export function VideoList({ initialVideos }: VideoListProps) {
  const router = useRouter();
  const [videos, setVideos] = useState(initialVideos);

  function handleDeleted(videoId: string) {
    // Immediately remove from local state
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
    // Also refresh server data
    router.refresh();
  }

  if (videos.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Video className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No videos yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Convert your first blog post to see it appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <BulkScheduleButton videos={videos} />
        <RescheduleFailedButton />
      </div>
      <div className="grid gap-4">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} onDeleted={handleDeleted} />
        ))}
      </div>
    </div>
  );
}
