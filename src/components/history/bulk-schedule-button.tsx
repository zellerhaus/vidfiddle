"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Calendar, Loader2 } from "lucide-react";
import type { VideoWithPostAndScheduled } from "@/lib/supabase/types";

interface BulkScheduleButtonProps {
  videos: VideoWithPostAndScheduled[];
}

export function BulkScheduleButton({ videos }: BulkScheduleButtonProps) {
  const router = useRouter();
  const [isScheduling, setIsScheduling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const unscheduledVideos = videos.filter(
    (v) =>
      v.status === "completed" &&
      v.video_url &&
      v.scheduled_posts.length === 0
  );

  if (unscheduledVideos.length === 0) return null;

  async function handleScheduleAll() {
    setIsScheduling(true);
    const total = unscheduledVideos.length;
    setProgress({ done: 0, total });

    let scheduled = 0;
    let failed = 0;

    for (let i = 0; i < unscheduledVideos.length; i++) {
      const video = unscheduledVideos[i];
      try {
        const response = await fetch("/api/schedule/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: video.id, batchIndex: i, batchSize: total }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed");
        }

        scheduled++;
      } catch {
        failed++;
      }
      setProgress({ done: scheduled + failed, total });
    }

    if (scheduled > 0) {
      toast.success(
        `${scheduled} video${scheduled === 1 ? "" : "s"} scheduled`
      );
    }
    if (failed > 0) {
      toast.error(
        `${failed} video${failed === 1 ? "" : "s"} failed to schedule`
      );
    }

    setIsScheduling(false);
    setProgress({ done: 0, total: 0 });
    router.refresh();
  }

  return (
    <Button onClick={handleScheduleAll} disabled={isScheduling}>
      {isScheduling ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Scheduling {progress.done}/{progress.total}...
        </>
      ) : (
        <>
          <Calendar className="h-4 w-4 mr-2" />
          Schedule All ({unscheduledVideos.length})
        </>
      )}
    </Button>
  );
}
