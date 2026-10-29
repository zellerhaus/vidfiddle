"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Video,
  Calendar,
  Download,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Trash2,
  Clock,
  Repeat,
} from "lucide-react";
import type { VideoWithPostAndScheduled, ScheduledPost, Platform } from "@/lib/supabase/types";
import { RepostDialog } from "./repost-dialog";

const statusConfig = {
  pending: {
    label: "Pending",
    icon: Loader2,
    variant: "secondary" as const,
  },
  generating: {
    label: "Generating",
    icon: Loader2,
    variant: "default" as const,
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    variant: "default" as const,
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    variant: "destructive" as const,
  },
};

const styleLabels = {
  stock_footage: "Stock Footage + Voiceover",
  ai_avatar: "AI Avatar",
  text_on_screen: "Text on Screen",
};

function isLocalVideo(video: VideoWithPostAndScheduled): boolean {
  const styleOptions = video.style_options as Record<string, unknown> | null;
  return styleOptions?.apiVersion === "local";
}

function formatPublishedDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PlatformBadge({ post }: { post: ScheduledPost }) {
  const isPublished = post.status === "posted" && post.published_at;
  const hasUrl = !!post.platform_post_url;

  const badgeContent = (
    <Badge
      variant={isPublished ? "default" : "outline"}
      className={`text-xs flex items-center gap-1 ${hasUrl ? "cursor-pointer hover:bg-accent" : ""} ${
        isPublished ? "bg-green-600 hover:bg-green-700" : ""
      }`}
    >
      {isPublished ? (
        <CheckCircle className="h-3 w-3" />
      ) : post.status === "scheduled" ? (
        <Clock className="h-3 w-3" />
      ) : null}
      <span className="capitalize">{post.platform}</span>
      {isPublished && post.published_at && (
        <span className="text-[10px] opacity-80">
          {formatPublishedDate(post.published_at)}
        </span>
      )}
      {!isPublished && post.status === "scheduled" && (
        <span className="text-[10px] opacity-70">Scheduled</span>
      )}
      {hasUrl && <ExternalLink className="h-2.5 w-2.5 ml-0.5" />}
    </Badge>
  );

  if (hasUrl && post.platform_post_url) {
    return (
      <a
        href={post.platform_post_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block"
      >
        {badgeContent}
      </a>
    );
  }

  return badgeContent;
}

interface VideoCardProps {
  video: VideoWithPostAndScheduled;
  onDeleted: (videoId: string) => void;
}

export function VideoCard({ video, onDeleted }: VideoCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [repostDialogOpen, setRepostDialogOpen] = useState(false);
  const [selectedPostForRepost, setSelectedPostForRepost] = useState<ScheduledPost | null>(null);

  const status = statusConfig[video.status];
  const StatusIcon = status.icon;
  const statusLabel =
    isLocalVideo(video) &&
    (video.status === "pending" || video.status === "generating")
      ? "Rendering locally…"
      : status.label;

  // Check if video has any published posts (eligible for repost)
  const publishedPosts = video.scheduled_posts.filter(
    (post) => post.status === "posted" && post.published_at
  );
  const hasPublishedPosts = publishedPosts.length > 0;

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/videos/${video.id}/delete`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete video");
      }

      toast.success("Video deleted");
      onDeleted(video.id);
    } catch (error) {
      toast.error("Failed to delete video");
      setIsDeleting(false);
    }
  }

  function handleOpenRepostDialog(post: ScheduledPost) {
    setSelectedPostForRepost(post);
    setRepostDialogOpen(true);
  }

  async function handleRepost(
    scheduledPostId: string,
    platforms: Platform[],
    captions?: Record<Platform, string>
  ) {
    const response = await fetch(`/api/scheduled/${scheduledPostId}/repost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms, captions }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to schedule repost");
    }

    const data = await response.json();
    const platformList = data.scheduledPlatforms?.join(", ") || platforms.join(", ");
    toast.success(`Repost scheduled to: ${platformList}`);
  }

  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-4">
        <div className="relative flex h-20 w-32 items-center justify-center rounded-lg bg-muted flex-shrink-0 overflow-hidden">
          {video.video_url ? (
            <video
              src={video.video_url}
              className="h-full w-full object-cover"
              muted
            />
          ) : (
            <Video className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium truncate">{video.blog_posts.title}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {styleLabels[video.style]}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(video.created_at).toLocaleDateString()}
                </span>
                {video.duration_seconds && (
                  <span>{video.duration_seconds}s</span>
                )}
              </div>
            </div>
            <Badge variant={status.variant} className="gap-1">
              <StatusIcon
                className={`h-3 w-3 ${
                  video.status === "generating" ? "animate-spin" : ""
                }`}
              />
              {statusLabel}
            </Badge>
          </div>
          {video.scheduled_posts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {video.scheduled_posts.map((post) => (
                <PlatformBadge key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          {/* Continue button for in-progress videos */}
          {(video.status === "pending" ||
            video.status === "generating" ||
            video.status === "completed") &&
            video.scheduled_posts.length === 0 && (
              <Button size="sm" asChild>
                <Link href={`/convert/${video.blog_post_id}`}>
                  Continue
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            )}
          {video.video_url && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={video.video_url} download>
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={video.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  View
                </a>
              </Button>
              {/* Repost button for published videos */}
              {hasPublishedPosts && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenRepostDialog(publishedPosts[0])}
                >
                  <Repeat className="h-4 w-4 mr-1" />
                  Repost
                </Button>
              )}
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete video?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this video and any scheduled
                  posts. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>

      {/* Repost Dialog */}
      <RepostDialog
        open={repostDialogOpen}
        onOpenChange={setRepostDialogOpen}
        scheduledPost={selectedPostForRepost}
        videoTitle={video.blog_posts.title}
        onSubmit={handleRepost}
      />
    </Card>
  );
}
