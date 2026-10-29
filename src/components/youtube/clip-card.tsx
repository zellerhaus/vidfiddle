"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scissors, Loader2, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import type { YouTubeClip } from "@/lib/supabase/types";

interface ClipCardProps {
  clip: YouTubeClip;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Loader2 }
> = {
  pending: { label: "Pending", variant: "secondary", icon: Loader2 },
  cutting: { label: "Cutting", variant: "default", icon: Scissors },
  rendering_captions: {
    label: "Adding Captions",
    variant: "default",
    icon: Sparkles,
  },
  completed: { label: "Ready", variant: "outline", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
};

export function ClipCard({ clip }: ClipCardProps) {
  const config = statusConfig[clip.status] || statusConfig.pending;
  const StatusIcon = config.icon;
  const isProcessing =
    clip.status === "cutting" || clip.status === "rendering_captions";
  const isComplete = clip.status === "completed";
  const videoUrl = clip.captioned_clip_url || clip.raw_clip_url;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex gap-4">
          {/* Video preview */}
          <div className="w-40 shrink-0">
            {isComplete && videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-lg aspect-[9/16] object-cover bg-muted"
              />
            ) : (
              <div className="w-full rounded-lg aspect-[9/16] bg-muted flex items-center justify-center">
                {isProcessing ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <Scissors className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            )}
          </div>

          {/* Clip info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-sm truncate">{clip.title}</h3>
              <Badge variant={config.variant} className="shrink-0">
                <StatusIcon
                  className={`h-3 w-3 mr-1 ${isProcessing ? "animate-spin" : ""}`}
                />
                {config.label}
              </Badge>
            </div>

            <div className="text-xs text-muted-foreground mt-1">
              {formatTime(clip.start_time)} - {formatTime(clip.end_time)}{" "}
              ({Math.round(clip.duration_seconds)}s)
            </div>

            {clip.viral_score !== null && (
              <div className="flex items-center gap-1 mt-2">
                <Sparkles className="h-3 w-3 text-yellow-500" />
                <span className="text-xs font-medium">
                  {Math.round(clip.viral_score * 100)}% viral score
                </span>
              </div>
            )}

            {clip.hook_reason && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {clip.hook_reason}
              </p>
            )}

            {clip.error_message && (
              <p className="text-xs text-destructive mt-2">
                {clip.error_message}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
