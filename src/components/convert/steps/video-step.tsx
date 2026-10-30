"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, Loader2, Video, RefreshCw, Download } from "lucide-react";
import type { StyleOptions } from "./style-step";

interface VideoStepProps {
  postId: string;
  segmentId?: string;
  script: string;
  styleOptions: StyleOptions;
  existingVideoId?: string | null;
  existingVideoUrl?: string | null;
  onComplete: (videoId: string, videoUrl: string) => void;
  onBack: () => void;
}

type GenerationStatus = "idle" | "generating" | "completed" | "failed";

export function VideoStep({
  postId,
  segmentId,
  script,
  styleOptions,
  existingVideoId,
  existingVideoUrl,
  onComplete,
  onBack,
}: VideoStepProps) {
  // Initialize state from existing video if provided
  const [status, setStatus] = useState<GenerationStatus>(() => {
    if (existingVideoUrl) return "completed";
    if (existingVideoId) return "generating";
    return "idle";
  });
  const [progress, setProgress] = useState(existingVideoUrl ? 100 : 0);
  const [videoId, setVideoId] = useState<string | null>(existingVideoId || null);
  const [videoUrl, setVideoUrl] = useState<string | null>(existingVideoUrl || null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);
  const isLocal = styleOptions.apiMethod === "local";

  useEffect(() => {
    // If we have an existing video that's generating, poll its status
    if (existingVideoId && !existingVideoUrl) {
      pollStatus(existingVideoId);
      return;
    }

    // Auto-start generation when component mounts (only if no existing video)
    if (status === "idle" && !existingVideoId) {
      startGeneration();
    }
  }, [existingVideoId, existingVideoUrl]);

  async function startGeneration() {
    setStatus("generating");
    setProgress(0);
    setError(null);

    try {
      // Start video generation
      const response = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blogPostId: postId,
          contentSegmentId: segmentId,
          script,
          apiMethod: styleOptions.apiMethod || "ai_shorts",
          style: styleOptions.creatifyStyle,
          aspectRatio: styleOptions.aspectRatio,
          voiceoverVolume: styleOptions.voiceoverVolume,
          backgroundMusicVolume: styleOptions.backgroundMusicVolume,
          accentId: styleOptions.voiceId,
          visualStyle: styleOptions.visualStyle,
          videoLength: styleOptions.videoLength,
          avatarId: styleOptions.avatarId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Failed to start video generation");
      }

      setVideoId(data.videoId);
      if (data.creditsUsed) {
        setCreditsUsed(data.creditsUsed);
      }

      // Brief delay to ensure database is updated before polling
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Poll for status
      pollStatus(data.videoId);
    } catch (error) {
      setStatus("failed");
      setError(error instanceof Error ? error.message : "Unknown error");
      toast.error("Failed to start video generation");
    }
  }

  async function pollStatus(id: string) {
    const poll = async () => {
      try {
        // POST to refresh status from the renderer
        const response = await fetch(`/api/videos/${id}`, {
          method: "POST",
        });

        const data = await response.json();

        // Handle case where video is still pending
        if (!response.ok) {
          if (data.status === "pending" || data.status === "generating") {
            // Still processing, continue polling
            return false;
          }
          if (data.status === "failed") {
            setStatus("failed");
            setError(data.error_message || "Video generation failed");
            return true;
          }
          console.error("Status check error:", data);
          // Don't stop polling on transient errors
          return false;
        }

        // Update progress from remote renderers
        if (data.creatifyProgress !== undefined) {
          setProgress(Math.round(data.creatifyProgress * 100));
        }

        if (data.previewUrl) {
          setPreviewUrl(data.previewUrl);
        }

        if (data.status === "completed") {
          setStatus("completed");
          setProgress(100);
          setVideoUrl(data.video_url);
          if (data.creditsUsed) {
            setCreditsUsed(data.creditsUsed);
          }
          toast.success("Video generated successfully!");
          return true; // Stop polling
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error_message || "Video generation failed");
          toast.error("Video generation failed");
          return true; // Stop polling
        }

        return false; // Continue polling
      } catch (error) {
        console.error("Poll error:", error);
        // Don't stop polling on transient errors
        return false;
      }
    };

    // Initial poll
    const shouldStop = await poll();
    if (shouldStop) return;

    // Continue polling every 5 seconds
    const interval = setInterval(async () => {
      const shouldStop = await poll();
      if (shouldStop) {
        clearInterval(interval);
      }
    }, 5000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }

  const aspectRatioClass = {
    "9x16": "aspect-[9/16] max-w-xs",
    "16x9": "aspect-video max-w-lg",
    "1x1": "aspect-square max-w-sm",
  }[styleOptions.aspectRatio];

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Generate Video
          </CardTitle>
          <CardDescription>
            {isLocal
              ? `Rendering locally with OpenAI (${styleOptions.aspectRatio}).`
              : `Creating your ${styleOptions.creatifyStyle} video (${styleOptions.aspectRatio}).`}
            This typically takes 2-5 minutes.
            {!isLocal && creditsUsed && ` • ${creditsUsed} credits used`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === "generating" && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                <div className="relative">
                  <div className="h-24 w-24 rounded-full border-4 border-muted flex items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin" />
                  </div>
                </div>
              </div>
              <Progress value={progress} />
              <p className="text-center text-sm text-muted-foreground">
                {isLocal && "Rendering locally…"}
                {!isLocal && progress < 20 && "Queued for processing..."}
                {!isLocal && progress >= 20 && progress < 50 && "Generating video content..."}
                {!isLocal && progress >= 50 && progress < 80 && "Adding voiceover and effects..."}
                {!isLocal && progress >= 80 && "Finalizing video..."}
              </p>
              {previewUrl && (
                <p className="text-center text-xs text-muted-foreground">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View preview
                  </a>
                </p>
              )}
            </div>
          )}

          {status === "completed" && videoUrl && (
            <div className="space-y-4">
              <div className={`${aspectRatioClass} mx-auto rounded-lg overflow-hidden bg-black`}>
                <video
                  src={videoUrl}
                  controls
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" asChild>
                  <a href={videoUrl} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          )}

          {status === "failed" && (
            <div className="text-center py-8">
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={startGeneration}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" onClick={onBack} disabled={status === "generating"}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Style
            </Button>
            {status === "completed" && videoId && videoUrl && (
              <Button onClick={() => onComplete(videoId, videoUrl)}>
                Continue to Captions
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
