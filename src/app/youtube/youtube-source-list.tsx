"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Youtube,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import type { YouTubeSource } from "@/lib/supabase/types";

interface YouTubeSourceListProps {
  initialSources: YouTubeSource[];
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Loader2 }
> = {
  pending: { label: "Queued", variant: "secondary", icon: Clock },
  downloading: { label: "Downloading", variant: "default", icon: Loader2 },
  transcribing: { label: "Transcribing", variant: "default", icon: Loader2 },
  analyzing: { label: "Analyzing", variant: "default", icon: Loader2 },
  processing: { label: "Processing", variant: "default", icon: Loader2 },
  completed: { label: "Complete", variant: "outline", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
};

export function YouTubeSourceList({ initialSources }: YouTubeSourceListProps) {
  if (initialSources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Youtube className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No YouTube videos yet</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          Paste a YouTube URL to automatically detect viral moments, cut clips,
          and add styled captions.
        </p>
        <Link href="/youtube/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add YouTube Video
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link href="/youtube/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add YouTube Video
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        {initialSources.map((source) => {
          const config = statusConfig[source.status] || statusConfig.pending;
          const StatusIcon = config.icon;
          const isProcessing = ![
            "completed",
            "failed",
            "pending",
          ].includes(source.status);

          return (
            <Link key={source.id} href={`/youtube/${source.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                    <Youtube className="h-5 w-5 text-red-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {source.title || source.youtube_url}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {source.channel_name && (
                        <span>{source.channel_name} &middot; </span>
                      )}
                      {source.duration_seconds
                        ? `${Math.floor(source.duration_seconds / 60)}:${(source.duration_seconds % 60).toString().padStart(2, "0")}`
                        : "Processing..."}
                    </div>
                  </div>

                  <Badge variant={config.variant}>
                    <StatusIcon
                      className={`h-3 w-3 mr-1 ${isProcessing ? "animate-spin" : ""}`}
                    />
                    {config.label}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
