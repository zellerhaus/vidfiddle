"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function ProcessingActions() {
  const [processingQueue, setProcessingQueue] = useState(false);
  const [checkingVideos, setCheckingVideos] = useState(false);

  async function handleProcessQueue() {
    setProcessingQueue(true);
    try {
      const res = await fetch("/api/queue/process", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.processed === 0) {
        toast.info("No pending items in queue");
      } else {
        toast.success(
          `Processed ${data.succeeded}/${data.processed} queue items`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to process queue"
      );
    } finally {
      setProcessingQueue(false);
    }
  }

  async function handleCheckVideos() {
    setCheckingVideos(true);
    try {
      const res = await fetch("/api/videos/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.checked === 0) {
        toast.info("No videos currently generating");
      } else {
        const parts = [];
        if (data.completed > 0) parts.push(`${data.completed} completed`);
        if (data.stillGenerating > 0)
          parts.push(`${data.stillGenerating} still generating`);
        if (data.failed > 0) parts.push(`${data.failed} failed`);
        toast.success(`Checked ${data.checked} videos: ${parts.join(", ")}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to check videos"
      );
    } finally {
      setCheckingVideos(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Processing</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleProcessQueue}
          disabled={processingQueue}
        >
          {processingQueue ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {processingQueue ? "Processing..." : "Process Queue"}
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleCheckVideos}
          disabled={checkingVideos}
        >
          {checkingVideos ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {checkingVideos ? "Checking..." : "Check Video Status"}
        </Button>
      </CardContent>
    </Card>
  );
}
