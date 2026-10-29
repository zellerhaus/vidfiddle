"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";

interface FailedPost {
  id: string;
  platform: string;
  error_message: string | null;
}

export function RescheduleFailedButton() {
  const router = useRouter();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failedCount, setFailedCount] = useState<number | null>(null);

  // Fetch count on first render
  useState(() => {
    fetch("/api/schedule/reschedule-failed")
      .then((res) => res.json())
      .then((data) => {
        setFailedCount(data.failedPosts?.length || 0);
      })
      .catch(() => setFailedCount(0));
  });

  if (failedCount === null || failedCount === 0) return null;

  async function handleRescheduleAll() {
    setIsRescheduling(true);

    let failedPosts: FailedPost[];
    try {
      const res = await fetch("/api/schedule/reschedule-failed");
      const data = await res.json();
      failedPosts = data.failedPosts || [];
    } catch {
      toast.error("Failed to fetch failed posts");
      setIsRescheduling(false);
      return;
    }

    if (failedPosts.length === 0) {
      toast.info("No failed posts to reschedule");
      setIsRescheduling(false);
      setFailedCount(0);
      router.refresh();
      return;
    }

    const total = failedPosts.length;
    setProgress({ done: 0, total });

    let rescheduled = 0;
    let errors = 0;

    for (let i = 0; i < failedPosts.length; i++) {
      const post = failedPosts[i];
      try {
        const response = await fetch("/api/schedule/reschedule-failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledPostId: post.id }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed");
        }

        rescheduled++;
      } catch {
        errors++;
      }
      setProgress({ done: rescheduled + errors, total });
    }

    if (rescheduled > 0) {
      toast.success(
        `${rescheduled} post${rescheduled === 1 ? "" : "s"} rescheduled`
      );
    }
    if (errors > 0) {
      toast.error(
        `${errors} post${errors === 1 ? "" : "s"} failed to reschedule`
      );
    }

    setIsRescheduling(false);
    setProgress({ done: 0, total: 0 });
    setFailedCount(errors);
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      onClick={handleRescheduleAll}
      disabled={isRescheduling}
    >
      {isRescheduling ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Rescheduling {progress.done}/{progress.total}...
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 mr-2" />
          Reschedule Failed ({failedCount})
        </>
      )}
    </Button>
  );
}
