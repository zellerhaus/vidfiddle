"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { Platform, ScheduledPost } from "@/lib/supabase/types";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter" },
  { value: "facebook", label: "Facebook" },
];

interface RepostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledPost: ScheduledPost | null;
  videoTitle: string;
  onSubmit: (
    scheduledPostId: string,
    platforms: Platform[],
    captions?: Record<Platform, string>
  ) => Promise<void>;
}

export function RepostDialog({
  open,
  onOpenChange,
  scheduledPost,
  videoTitle,
  onSubmit,
}: RepostDialogProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [caption, setCaption] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when dialog opens with new post
  useEffect(() => {
    if (open && scheduledPost) {
      // Pre-select the same platform as the original post
      setSelectedPlatforms([scheduledPost.platform]);
      // Pre-fill caption from original post
      setCaption(scheduledPost.caption || "");
    }
  }, [open, scheduledPost]);

  const handlePlatformToggle = (platform: Platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  };

  const handleSubmit = async () => {
    if (!scheduledPost || selectedPlatforms.length === 0) return;

    setIsSubmitting(true);
    try {
      // Build captions object using the same caption for all selected platforms
      const captions: Record<Platform, string> = {} as Record<Platform, string>;
      if (caption.trim()) {
        for (const platform of selectedPlatforms) {
          captions[platform] = caption;
        }
      }

      await onSubmit(
        scheduledPost.id,
        selectedPlatforms,
        caption.trim() ? captions : undefined
      );

      // Reset state on success
      setSelectedPlatforms([]);
      setCaption("");
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setSelectedPlatforms([]);
    setCaption("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Repost Video</DialogTitle>
          <DialogDescription>
            Schedule a repost of &quot;{videoTitle}&quot; to your social platforms.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Select Platforms</Label>
            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map((platform) => (
                <div key={platform.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`platform-${platform.value}`}
                    checked={selectedPlatforms.includes(platform.value)}
                    onCheckedChange={() => handlePlatformToggle(platform.value)}
                    disabled={isSubmitting}
                  />
                  <Label
                    htmlFor={`platform-${platform.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {platform.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="caption" className="text-sm font-medium">
              Caption (optional)
            </Label>
            <Textarea
              id="caption"
              placeholder="Enter a caption for the repost, or leave blank to use the original caption..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="min-h-24"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the original or generated caption for each platform.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedPlatforms.length === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scheduling...
              </>
            ) : (
              `Repost to ${selectedPlatforms.length} Platform${selectedPlatforms.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
