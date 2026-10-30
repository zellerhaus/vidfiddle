"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Plus, Loader2, Zap } from "lucide-react";
import type { Platform } from "@/lib/supabase/types";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "Twitter" },
  { id: "facebook", label: "Facebook" },
];

export function AddFeedDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);
  const [autoVideosPerPost, setAutoVideosPerPost] = useState(1);
  const [autoPlatforms, setAutoPlatforms] = useState<Platform[]>([]);
  const [initialImportLimit, setInitialImportLimit] = useState(10);
  const [importAll, setImportAll] = useState(false);
  const router = useRouter();

  function resetForm() {
    setUrl("");
    setAutoModeEnabled(false);
    setAutoVideosPerPost(1);
    setAutoPlatforms([]);
    setInitialImportLimit(10);
    setImportAll(false);
  }

  function togglePlatform(platform: Platform) {
    setAutoPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);

    try {
      const response = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          auto_mode_enabled: autoModeEnabled,
          auto_videos_per_post: autoModeEnabled ? autoVideosPerPost : 1,
          auto_platforms: autoModeEnabled ? autoPlatforms : [],
          initial_import_limit: importAll ? 0 : initialImportLimit,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add feed");
      }

      const feed = await response.json();
      toast.success(`Added feed: ${feed.title || feed.url}`);
      resetForm();
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add feed"
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Feed
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add RSS Feed</DialogTitle>
            <DialogDescription>
              Enter the URL of an RSS or Atom feed to start monitoring for new
              content.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            <div>
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input
                id="feed-url"
                type="url"
                placeholder="https://example.com/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-2"
                disabled={isLoading}
              />
            </div>

            {/* Import Limit */}
            <div>
              <Label className="text-sm">Initial Import Limit</Label>
              <div className="flex items-center space-x-3 mt-2">
                <Checkbox
                  id="import-all"
                  checked={importAll}
                  onCheckedChange={(checked) => setImportAll(checked === true)}
                  disabled={isLoading}
                />
                <Label
                  htmlFor="import-all"
                  className="text-sm cursor-pointer"
                >
                  Import all posts (no limit)
                </Label>
              </div>
              {!importAll && (
                <div className="mt-3">
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[initialImportLimit]}
                      onValueChange={([value]) => setInitialImportLimit(value)}
                      min={10}
                      max={500}
                      step={10}
                      className="flex-1"
                      disabled={isLoading}
                    />
                    <span className="text-sm font-medium w-12 text-right">
                      {initialImportLimit}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Number of most recent posts to import (10-500)
                  </p>
                </div>
              )}
            </div>

            {/* Auto Mode Toggle */}
            <div className="flex items-center space-x-3 pt-2">
              <Checkbox
                id="auto-mode"
                checked={autoModeEnabled}
                onCheckedChange={(checked) =>
                  setAutoModeEnabled(checked === true)
                }
                disabled={isLoading}
              />
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="auto-mode"
                  className="text-sm font-medium cursor-pointer"
                >
                  Enable Auto Mode
                </Label>
                <Zap className="h-4 w-4" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-4 ml-7">
              Automatically generate and schedule videos for new posts
            </p>

            {/* Auto Mode Settings */}
            {autoModeEnabled && (
              <div className="space-y-4 pl-7 border-l-[3px] border-pastel-yellow">
                {/* Videos per Post */}
                <div>
                  <Label className="text-sm">
                    Videos per post: {autoVideosPerPost}
                  </Label>
                  <Slider
                    value={[autoVideosPerPost]}
                    onValueChange={([value]) => setAutoVideosPerPost(value)}
                    min={1}
                    max={5}
                    step={1}
                    className="mt-2"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Create multiple video angles from each blog post
                  </p>
                </div>

                {/* Platform Selection */}
                <div>
                  <Label className="text-sm">Target Platforms</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {PLATFORMS.map((platform) => (
                      <div
                        key={platform.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`platform-${platform.id}`}
                          checked={autoPlatforms.includes(platform.id)}
                          onCheckedChange={() => togglePlatform(platform.id)}
                          disabled={isLoading}
                        />
                        <Label
                          htmlFor={`platform-${platform.id}`}
                          className="text-sm cursor-pointer"
                        >
                          {platform.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Videos will be scheduled to selected platforms after
                    approval
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !url.trim()}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Feed
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
