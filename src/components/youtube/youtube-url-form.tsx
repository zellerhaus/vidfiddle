"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Youtube, ArrowRight, Scissors } from "lucide-react";
import type { CaptionStylePreset } from "@/lib/supabase/types";

interface YouTubeUrlFormProps {
  captionPresets: CaptionStylePreset[];
  pipeline?: "submagic" | "legacy";
}

export function YouTubeUrlForm({ captionPresets, pipeline = "legacy" }: YouTubeUrlFormProps) {
  const isSubmagic = pipeline === "submagic";
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(
    captionPresets[0]?.id || ""
  );
  const [targetDuration, setTargetDuration] = useState("45");
  const [maxClips, setMaxClips] = useState("5");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);

    try {
      const captionStyle = captionPresets.find((p) => p.id === selectedStyle);

      const response = await fetch("/api/youtube/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          captionStyle,
          clipPreferences: {
            targetDuration: parseInt(targetDuration),
            maxClips: parseInt(maxClips),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.existingId) {
          toast.info("This video was already submitted");
          router.push(`/youtube/${data.existingId}`);
          return;
        }
        throw new Error(data.error || "Failed to submit YouTube URL");
      }

      toast.success("YouTube video submitted for processing!");
      router.push(`/youtube/${data.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit URL"
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5" />
            YouTube to Clips
          </CardTitle>
          <CardDescription>
            {isSubmagic
              ? "Paste a YouTube URL to automatically detect viral moments, cut clips, add captions, and apply face tracking."
              : "Paste a YouTube URL to automatically detect viral moments, cut clips, and add styled captions."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* URL Input */}
            <div>
              <Label htmlFor="youtube-url">YouTube URL</Label>
              <Input
                id="youtube-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-2"
                disabled={isLoading}
              />
            </div>

            {/* Clip Settings */}
            <div className={isSubmagic ? "" : "grid grid-cols-2 gap-4"}>
              <div>
                <Label htmlFor="target-duration">Max Clip Duration (seconds)</Label>
                <Select
                  value={targetDuration}
                  onValueChange={setTargetDuration}
                  disabled={isLoading}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="45">45 seconds</SelectItem>
                    <SelectItem value="60">60 seconds</SelectItem>
                    <SelectItem value="90">90 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isSubmagic && (
                <div>
                  <Label htmlFor="max-clips">Max Clips</Label>
                  <Select
                    value={maxClips}
                    onValueChange={setMaxClips}
                    disabled={isLoading}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 clips</SelectItem>
                      <SelectItem value="5">5 clips</SelectItem>
                      <SelectItem value="8">8 clips</SelectItem>
                      <SelectItem value="10">10 clips</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Caption Style — only for legacy pipeline (Submagic handles captions) */}
            {!isSubmagic && captionPresets.length > 0 && (
              <div>
                <Label>Caption Style</Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {captionPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedStyle(preset.id)}
                      disabled={isLoading}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        selectedStyle === preset.id
                          ? "border-black bg-primary shadow-hard-sm"
                          : "border-black bg-white hover:bg-accent"
                      }`}
                    >
                      <div className="font-medium text-sm">{preset.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {preset.fontFamily} &middot; {preset.animation || "none"}{" "}
                        animation
                      </div>
                      <div className="flex gap-2 mt-2">
                        <div
                          className="h-4 w-4 rounded-full border"
                          style={{ backgroundColor: preset.textColor }}
                          title="Text color"
                        />
                        <div
                          className="h-4 w-4 rounded-full border"
                          style={{ backgroundColor: preset.activeWordColor }}
                          title="Highlight color"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Scissors className="h-4 w-4 mr-2" />
                  Find Viral Clips
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
