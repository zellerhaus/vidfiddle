"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Video,
  Calendar,
  CheckCircle,
  XCircle,
  MessageSquare,
  Edit,
  Play,
} from "lucide-react";
import type { VideoWithPostAndScheduled, Platform } from "@/lib/supabase/types";

const styleLabels: Record<string, string> = {
  stock_footage: "Stock Footage + Voiceover",
  ai_avatar: "AI Avatar",
  text_on_screen: "Text on Screen",
};

interface VideoReviewCardProps {
  video: VideoWithPostAndScheduled;
  onApprove: (videoId: string) => void;
  onReject: (videoId: string) => void;
  onRequestChanges: (videoId: string) => void;
  onEditScript: (videoId: string) => void;
}

export function VideoReviewCard({
  video,
  onApprove,
  onReject,
  onRequestChanges,
  onEditScript,
}: VideoReviewCardProps) {
  // Parse generated captions if available
  const captions = video.generated_captions as Record<Platform, string> | null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-start gap-4">
            {/* Video Preview */}
            <div className="relative flex h-32 w-56 items-center justify-center rounded-lg bg-muted flex-shrink-0 overflow-hidden group">
              {video.video_url ? (
                <>
                  <video
                    src={video.video_url}
                    className="h-full w-full object-cover"
                    muted
                  />
                  <a
                    href={video.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Play className="h-8 w-8 text-white" />
                  </a>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-muted-foreground">
                  <Video className="h-8 w-8 mb-2" />
                  <span className="text-sm">Processing...</span>
                </div>
              )}
            </div>

            {/* Video Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{video.blog_posts.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {styleLabels[video.style] || video.style}
                  </p>
                </div>
                <Badge variant="secondary">Attempt #{video.generation_attempt}</Badge>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(video.created_at).toLocaleDateString()}
                </span>
                {video.duration_seconds && (
                  <span>{video.duration_seconds}s</span>
                )}
              </div>

              {/* Previous Feedback (if regenerated) */}
              {video.regeneration_feedback && (
                <div className="mt-3 p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded text-xs">
                  <span className="font-medium text-yellow-700 dark:text-yellow-500">
                    Previous feedback:
                  </span>{" "}
                  <span className="text-yellow-600 dark:text-yellow-400">
                    {video.regeneration_feedback}
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 flex-shrink-0">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => onApprove(video.id)}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onReject(video.id)}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRequestChanges(video.id)}
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                Request Changes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditScript(video.id)}
              >
                <Edit className="h-4 w-4 mr-1" />
                Edit Script
              </Button>
            </div>
          </div>

          {/* Script Section */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs font-medium text-muted-foreground mb-2">Script:</p>
            <p className="text-sm whitespace-pre-wrap">{video.script}</p>
          </div>

          {/* Generated Captions Section */}
          {captions && Object.keys(captions).length > 0 && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Generated Captions:
              </p>
              <div className="grid gap-2">
                {Object.entries(captions).map(([platform, caption]) => (
                  <div key={platform} className="flex items-start gap-2">
                    <Badge variant="outline" className="text-xs flex-shrink-0 capitalize">
                      {platform}
                    </Badge>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {caption}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
