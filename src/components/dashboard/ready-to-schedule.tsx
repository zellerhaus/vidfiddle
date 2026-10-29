"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Calendar, Loader2 } from "lucide-react";

interface ReadyToScheduleProps {
  count: number;
}

export function ReadyToSchedule({ count }: ReadyToScheduleProps) {
  const router = useRouter();
  const [isScheduling, setIsScheduling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  if (count === 0) return null;

  async function handleScheduleAll() {
    setIsScheduling(true);

    // Fetch the list of unscheduled video IDs
    let videoIds: string[];
    try {
      const res = await fetch("/api/schedule/bulk");
      const data = await res.json();
      videoIds = data.videoIds || [];
    } catch {
      toast.error("Failed to fetch videos to schedule");
      setIsScheduling(false);
      return;
    }

    if (videoIds.length === 0) {
      toast.info("No videos to schedule");
      setIsScheduling(false);
      router.refresh();
      return;
    }

    const total = videoIds.length;
    setProgress({ done: 0, total });

    let scheduled = 0;
    let failed = 0;

    for (let i = 0; i < videoIds.length; i++) {
      const videoId = videoIds[i];
      try {
        const response = await fetch("/api/schedule/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, batchIndex: i, batchSize: total }),
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

  const label = `${count} video${count === 1 ? "" : "s"}`;

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>{" "}
        ready to schedule.
      </p>
      <Button size="sm" onClick={handleScheduleAll} disabled={isScheduling}>
        {isScheduling ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {progress.total > 0
              ? `Scheduling ${progress.done}/${progress.total}...`
              : "Scheduling..."}
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            Schedule All
          </>
        )}
      </Button>
    </div>
  );
}
