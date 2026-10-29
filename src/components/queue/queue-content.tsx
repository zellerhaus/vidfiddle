"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { VideoReviewCard } from "./video-review-card";
import { FeedbackDialog } from "./feedback-dialog";
import { RejectDialog } from "./reject-dialog";
import { ScriptEditorModal } from "./script-editor-modal";
import type { VideoWithPostAndScheduled } from "@/lib/supabase/types";

interface QueueContentProps {
  initialVideos: VideoWithPostAndScheduled[];
}

export function QueueContent({ initialVideos }: QueueContentProps) {
  const router = useRouter();
  const [videos, setVideos] = useState(initialVideos);

  // Feedback dialog state
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [feedbackVideoId, setFeedbackVideoId] = useState<string | null>(null);
  const [feedbackVideoTitle, setFeedbackVideoTitle] = useState<string>("");

  // Reject dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectVideoId, setRejectVideoId] = useState<string | null>(null);
  const [rejectVideoTitle, setRejectVideoTitle] = useState<string>("");

  // Script editor state
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoWithPostAndScheduled | null>(null);

  const getVideoById = (videoId: string) => {
    return videos.find((v) => v.id === videoId);
  };

  const removeVideoFromList = (videoId: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
  };

  const handleApprove = async (videoId: string) => {
    try {
      const response = await fetch(`/api/queue/${videoId}/approve`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to approve video");
      }

      const result = await response.json();
      toast.success("Video approved", {
        description: result.scheduledPosts?.length
          ? `Scheduled to ${result.scheduledPosts.length} platform(s)`
          : "Video approved successfully",
      });
      removeVideoFromList(videoId);
      router.refresh();
    } catch (error) {
      console.error("Error approving video:", error);
      toast.error("Failed to approve video", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
    }
  };

  const handleRejectClick = (videoId: string) => {
    const video = getVideoById(videoId);
    setRejectVideoId(videoId);
    setRejectVideoTitle(video?.blog_posts?.title || "");
    setRejectDialogOpen(true);
  };

  const handleRejectSubmit = async (reason: string) => {
    if (!rejectVideoId) return;

    const videoId = rejectVideoId;
    try {
      const response = await fetch(`/api/queue/${videoId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reject video");
      }

      toast.success("Video rejected", {
        description: "The video has been marked as rejected",
      });
      removeVideoFromList(videoId);
      router.refresh();
    } catch (error) {
      console.error("Error rejecting video:", error);
      toast.error("Failed to reject video", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
      throw error; // Re-throw to keep dialog open
    }
  };

  const handleRequestChangesClick = (videoId: string) => {
    const video = getVideoById(videoId);
    setFeedbackVideoId(videoId);
    setFeedbackVideoTitle(video?.blog_posts?.title || "");
    setFeedbackDialogOpen(true);
  };

  const handleFeedbackSubmit = async (feedback: string) => {
    if (!feedbackVideoId) return;

    const videoId = feedbackVideoId;
    try {
      const response = await fetch(`/api/queue/${videoId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to request changes");
      }

      toast.success("Regeneration started", {
        description: "The video is being regenerated with your feedback",
      });
      removeVideoFromList(videoId);
      router.refresh();
    } catch (error) {
      console.error("Error requesting changes:", error);
      toast.error("Failed to request changes", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
      throw error; // Re-throw to keep dialog open
    }
  };

  const handleEditScriptClick = (videoId: string) => {
    const video = getVideoById(videoId);
    if (video) {
      setEditingVideo(video);
      setScriptEditorOpen(true);
    }
  };

  const handleScriptSave = async (script: string) => {
    if (!editingVideo) return;

    const videoId = editingVideo.id;
    try {
      const response = await fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update script");
      }

      // Update local state with new script
      setVideos((prev) =>
        prev.map((v) => (v.id === videoId ? { ...v, script } : v))
      );

      toast.success("Script updated", {
        description: "The video script has been saved",
      });
    } catch (error) {
      console.error("Error updating script:", error);
      toast.error("Failed to update script", {
        description: error instanceof Error ? error.message : "An error occurred",
      });
      throw error; // Re-throw to keep modal open
    }
  };

  if (videos.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Inbox className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No videos pending review</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Auto-generated videos will appear here for approval before being
            scheduled to your social platforms.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        {videos.map((video) => (
          <VideoReviewCard
            key={video.id}
            video={video}
            onApprove={handleApprove}
            onReject={handleRejectClick}
            onRequestChanges={handleRequestChangesClick}
            onEditScript={handleEditScriptClick}
          />
        ))}
      </div>

      {/* Feedback Dialog for Request Changes */}
      <FeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={setFeedbackDialogOpen}
        onSubmit={handleFeedbackSubmit}
        videoTitle={feedbackVideoTitle}
      />

      {/* Reject Dialog */}
      <RejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        onSubmit={handleRejectSubmit}
        videoTitle={rejectVideoTitle}
      />

      {/* Script Editor Modal */}
      <ScriptEditorModal
        open={scriptEditorOpen}
        onOpenChange={setScriptEditorOpen}
        onSave={handleScriptSave}
        initialScript={editingVideo?.script || ""}
        videoTitle={editingVideo?.blog_posts?.title}
      />
    </>
  );
}
