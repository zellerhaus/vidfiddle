"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  Check,
  X,
  ArrowRight,
  Zap,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { ContentSegment } from "@/lib/supabase/types";

interface SegmentPreviewProps {
  segments: ContentSegment[];
  blogPostId: string;
  onSegmentUpdate?: (segment: ContentSegment) => void;
}

interface SegmentItemProps {
  segment: ContentSegment;
  index: number;
  onUpdate?: (segment: ContentSegment) => void;
  queueStatus?: { status: string; error?: string };
}

function SegmentItem({ segment, index, onUpdate, queueStatus }: SegmentItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(segment.title);
  const [editedContent, setEditedContent] = useState(segment.content);
  const [isSaving, setIsSaving] = useState(false);

  const keyPoints = Array.isArray(segment.key_points)
    ? (segment.key_points as string[])
    : [];

  // Estimate duration based on content length (150 words per minute)
  const wordCount = segment.content.split(/\s+/).length;
  const estimatedDuration = Math.ceil((wordCount / 150) * 60);

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/content/segments/${segment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editedTitle,
          content: editedContent,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update segment");
      }

      const { segment: updatedSegment } = await response.json();
      onUpdate?.(updatedSegment);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating segment:", error);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setEditedTitle(segment.title);
    setEditedContent(segment.content);
    setIsEditing(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                <Label htmlFor={`title-${segment.id}`}>Title</Label>
                <Input
                  id={`title-${segment.id}`}
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Segment title"
                />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Video {index + 1}</Badge>
                  <CardTitle className="text-base">{segment.title}</CardTitle>
                  {queueStatus && (
                    <Badge
                      variant={
                        queueStatus.status === "completed"
                          ? "default"
                          : queueStatus.status === "failed"
                          ? "destructive"
                          : queueStatus.status === "processing"
                          ? "default"
                          : "outline"
                      }
                      className="capitalize"
                    >
                      {queueStatus.status === "processing" && (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      )}
                      {queueStatus.status}
                    </Badge>
                  )}
                </div>
                <CardDescription className="flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  <span>~{formatDuration(estimatedDuration)}</span>
                  {queueStatus?.error && (
                    <span className="text-destructive ml-2">
                      Error: {queueStatus.error}
                    </span>
                  )}
                </CardDescription>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  <Check className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Key points always visible */}
        {keyPoints.length > 0 && !isEditing && (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Key Points
            </p>
            <ul className="space-y-1">
              {keyPoints.map((point, i) => (
                <li
                  key={i}
                  className="text-sm text-muted-foreground flex items-start gap-2"
                >
                  <span className="text-primary mt-1">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Expandable content or edit mode */}
        {isEditing ? (
          <div className="space-y-2">
            <Label htmlFor={`content-${segment.id}`}>Content</Label>
            <Textarea
              id={`content-${segment.id}`}
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              placeholder="Segment content"
              rows={6}
            />
          </div>
        ) : (
          isExpanded && (
            <div className="border-t pt-3 mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Full Content
              </p>
              <p className="text-sm whitespace-pre-wrap">{segment.content}</p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

export function SegmentPreview({
  segments,
  blogPostId,
  onSegmentUpdate,
}: SegmentPreviewProps) {
  const router = useRouter();
  const [localSegments, setLocalSegments] = useState(segments);
  const [isQueueing, setIsQueueing] = useState(false);
  const [queueStatuses, setQueueStatuses] = useState<
    Record<string, { status: string; error?: string }>
  >({});

  // Fetch queue status on mount and periodically
  React.useEffect(() => {
    async function fetchQueueStatus() {
      try {
        const response = await fetch(`/api/content/${blogPostId}/segments/queue`);
        if (response.ok) {
          const data = await response.json();
          setQueueStatuses(data.statuses || {});
        }
      } catch (error) {
        console.error("Error fetching queue status:", error);
      }
    }

    fetchQueueStatus();

    // Poll every 10 seconds if there are pending/processing items
    const interval = setInterval(fetchQueueStatus, 10000);
    return () => clearInterval(interval);
  }, [blogPostId]);

  function handleSegmentUpdate(updatedSegment: ContentSegment) {
    setLocalSegments((prev) =>
      prev.map((s) => (s.id === updatedSegment.id ? updatedSegment : s))
    );
    onSegmentUpdate?.(updatedSegment);
  }

  async function handleGenerateAll() {
    setIsQueueing(true);
    try {
      const response = await fetch(`/api/content/${blogPostId}/segments/queue`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add to queue");
      }

      toast.success(data.message);

      // Refresh queue statuses
      const statusResponse = await fetch(`/api/content/${blogPostId}/segments/queue`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setQueueStatuses(statusData.statuses || {});
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add to queue");
    } finally {
      setIsQueueing(false);
    }
  }

  function handleContinueToWizard() {
    // Navigate to conversion wizard with the first segment
    // The wizard will handle multi-segment processing
    const segmentIds = localSegments.map((s) => s.id).join(",");
    router.push(`/convert/${blogPostId}?segments=${segmentIds}`);
  }

  // Check if all segments are already queued or completed
  const allQueued = localSegments.every(
    (s) => queueStatuses[s.id]?.status === "pending" || queueStatuses[s.id]?.status === "processing"
  );

  const hasAnyQueued = Object.keys(queueStatuses).length > 0;

  if (localSegments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No segments generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {localSegments.length} segment{localSegments.length !== 1 ? "s" : ""}{" "}
          generated
        </p>
        {hasAnyQueued && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/queue")}
          >
            View Approval Queue
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {localSegments.map((segment, index) => (
          <SegmentItem
            key={segment.id}
            segment={segment}
            index={index}
            onUpdate={handleSegmentUpdate}
            queueStatus={queueStatuses[segment.id]}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <Button
          onClick={handleGenerateAll}
          disabled={isQueueing || allQueued}
          className="flex-1"
          variant="default"
        >
          {isQueueing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 mr-2" />
          )}
          {allQueued ? "All Queued" : "Generate All Videos"}
        </Button>
        <Button onClick={handleContinueToWizard} variant="outline" className="flex-1">
          Manual Wizard
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
