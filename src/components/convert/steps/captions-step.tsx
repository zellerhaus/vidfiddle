"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { BlogPost, Platform } from "@/lib/supabase/types";

interface CaptionsStepProps {
  post: BlogPost;
  script: string;
  videoId: string;
  initialCaptions?: Record<Platform, string>;
  onComplete: (captions: Record<Platform, string>, platforms: Platform[]) => void;
  onBack: () => void;
}

const platforms: { id: Platform; name: string; maxLength?: number }[] = [
  { id: "instagram", name: "Instagram", maxLength: 2200 },
  { id: "tiktok", name: "TikTok", maxLength: 2200 },
  { id: "youtube", name: "YouTube Shorts" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "twitter", name: "Twitter/X", maxLength: 280 },
  { id: "facebook", name: "Facebook" },
];

export function CaptionsStep({ post, script, videoId, initialCaptions, onComplete, onBack }: CaptionsStepProps) {
  // Determine which platforms have initial captions
  const platformsWithInitialCaptions = initialCaptions
    ? (Object.keys(initialCaptions).filter(
        (p) => initialCaptions[p as Platform]?.length > 0
      ) as Platform[])
    : [];

  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(
    platformsWithInitialCaptions.length > 0
      ? platformsWithInitialCaptions
      : []
  );

  // Fetch default platforms from settings (only if no initial captions)
  useEffect(() => {
    if (platformsWithInitialCaptions.length > 0) return;

    fetch("/api/settings/platforms")
      .then((res) => res.json())
      .then((data) => {
        if (data.platforms?.length > 0) {
          setSelectedPlatforms(data.platforms);
        } else {
          setSelectedPlatforms(["instagram", "tiktok"]);
        }
      })
      .catch(() => {
        setSelectedPlatforms(["instagram", "tiktok"]);
      });
  }, [platformsWithInitialCaptions.length]);
  const [captions, setCaptions] = useState<Record<Platform, string>>(
    initialCaptions || {
      instagram: "",
      tiktok: "",
      youtube: "",
      linkedin: "",
      twitter: "",
      facebook: "",
    }
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFor, setGeneratedFor] = useState<Platform[]>(platformsWithInitialCaptions);

  async function generateCaptions() {
    if (selectedPlatforms.length === 0) {
      toast.error("Select at least one platform");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/captions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: post.title,
          script,
          platforms: selectedPlatforms,
          videoId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate captions");
      }

      const data = await response.json();
      setCaptions((prev) => ({ ...prev, ...data.captions }));
      setGeneratedFor(selectedPlatforms);
      if (data.cached) {
        toast.success("Loaded saved captions!");
      } else {
        toast.success("Captions generated!");
      }
    } catch (error) {
      toast.error("Failed to generate captions");
    } finally {
      setIsGenerating(false);
    }
  }

  async function regenerateCaption(platform: Platform) {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/captions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: post.title,
          script,
          platforms: [platform],
          videoId,
          regenerate: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to regenerate caption");
      }

      const data = await response.json();
      setCaptions((prev) => ({ ...prev, [platform]: data.captions[platform] }));
      toast.success(`${platform} caption regenerated!`);
    } catch (error) {
      toast.error("Failed to regenerate caption");
    } finally {
      setIsGenerating(false);
    }
  }

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  }

  const hasGeneratedCaptions = generatedFor.length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Social Media Captions</CardTitle>
          <CardDescription>
            Generate and edit captions for each platform. Different platforms
            have different optimal styles and lengths.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform Selection */}
          <div>
            <Label className="mb-3 block">Select Platforms</Label>
            <div className="flex flex-wrap gap-4">
              {platforms.map((platform) => (
                <label
                  key={platform.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedPlatforms.includes(platform.id)}
                    onCheckedChange={() => togglePlatform(platform.id)}
                  />
                  <span className="text-sm">{platform.name}</span>
                </label>
              ))}
            </div>
          </div>

          {!hasGeneratedCaptions ? (
            <Button
              onClick={generateCaptions}
              disabled={isGenerating || selectedPlatforms.length === 0}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating captions...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Captions with Claude
                </>
              )}
            </Button>
          ) : (
            <Tabs defaultValue={selectedPlatforms[0]} className="space-y-4">
              <TabsList className="flex-wrap h-auto gap-1">
                {selectedPlatforms.map((platform) => {
                  const p = platforms.find((pl) => pl.id === platform)!;
                  return (
                    <TabsTrigger key={platform} value={platform}>
                      {p.name}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {selectedPlatforms.map((platform) => {
                const p = platforms.find((pl) => pl.id === platform)!;
                const caption = captions[platform];
                const length = caption.length;

                return (
                  <TabsContent key={platform} value={platform} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>{p.name} Caption</Label>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>
                          {length}
                          {p.maxLength && ` / ${p.maxLength}`} chars
                        </span>
                        {p.maxLength && length > p.maxLength && (
                          <span className="text-destructive">(too long!)</span>
                        )}
                      </div>
                    </div>
                    <Textarea
                      value={caption}
                      onChange={(e) =>
                        setCaptions((prev) => ({
                          ...prev,
                          [platform]: e.target.value,
                        }))
                      }
                      rows={6}
                      placeholder={`Enter your ${p.name} caption...`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => regenerateCaption(platform)}
                      disabled={isGenerating}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Regenerate
                    </Button>
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Video
            </Button>
            <Button
              onClick={() => onComplete(captions, selectedPlatforms)}
              disabled={!hasGeneratedCaptions || selectedPlatforms.length === 0}
            >
              Continue to Schedule
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
