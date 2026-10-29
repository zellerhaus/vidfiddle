"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Film, Link2, Server, User } from "lucide-react";
import {
  CREATIFY_STYLES,
  CREATIFY_ASPECT_RATIOS,
  LINK_TO_VIDEO_VISUAL_STYLES,
  LINK_TO_VIDEO_LENGTHS,
  type CreatifyStyle,
  type CreatifyAspectRatio,
} from "@/lib/creatify";
import { VoiceSelector } from "@/components/settings/voice-selector";
import { AvatarSelector } from "@/components/settings/avatar-selector";
import type { VideoDefaults, CreatifyApiMethod } from "@/lib/supabase/types";

export interface StyleOptions {
  apiMethod: CreatifyApiMethod;
  creatifyStyle: CreatifyStyle;
  visualStyle?: string;
  videoLength?: number;
  avatarId?: string | null;
  aspectRatio: CreatifyAspectRatio;
  voiceoverVolume: number;
  backgroundMusicVolume: number;
  voiceId: string | null;
}

interface StyleStepProps {
  script: string;
  onComplete: (options: StyleOptions) => void;
  onBack: () => void;
}

const API_METHODS: { value: CreatifyApiMethod; label: string; description: string; icon: React.ElementType }[] = [
  { value: "ai_shorts", label: "AI Shorts", description: "Stock footage with AI visuals", icon: Film },
  { value: "link_to_video", label: "Link to Video", description: "Blog URL with templates", icon: Link2 },
  { value: "lipsync_v2", label: "AI Avatar", description: "Avatar with lip sync", icon: User },
  {
    value: "local",
    label: "Local engine (OpenAI)",
    description: "Renders on your server with OpenAI voice, images and captions. Needs OPENAI_API_KEY. About $0.05 per 30-second video.",
    icon: Server,
  },
];

type VideoDefaultsResponse = VideoDefaults & {
  capabilities?: {
    preferredApiMethod?: CreatifyApiMethod;
  };
};

export function StyleStep({ script, onComplete, onBack }: StyleStepProps) {
  const [apiMethod, setApiMethod] = useState<CreatifyApiMethod>("ai_shorts");
  const [selectedStyle, setSelectedStyle] = useState<CreatifyStyle>("4K realistic");
  const [visualStyle, setVisualStyle] = useState("FullScreenTemplate");
  const [videoLength, setVideoLength] = useState(30);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<CreatifyAspectRatio>("9x16");
  const [voiceoverVolume, setVoiceoverVolume] = useState(0.8);
  const [backgroundMusicVolume, setBackgroundMusicVolume] = useState(0.3);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);

  // Fetch video defaults on mount
  useEffect(() => {
    async function fetchDefaults() {
      try {
        const response = await fetch("/api/settings/defaults");
        if (response.ok) {
          const defaults: VideoDefaultsResponse = await response.json();
          // API method
          if (defaults.apiMethod) {
            setApiMethod(defaults.apiMethod);
          } else if (defaults.capabilities?.preferredApiMethod) {
            setApiMethod(defaults.capabilities.preferredApiMethod);
          }
          // AI Shorts style
          if (defaults.creatifyStyle) {
            setSelectedStyle(defaults.creatifyStyle as CreatifyStyle);
          }
          // Link-to-Video options
          if (defaults.visualStyle) {
            setVisualStyle(defaults.visualStyle);
          }
          if (defaults.videoLength) {
            setVideoLength(defaults.videoLength);
          }
          // Lipsync V2 options
          if (defaults.avatarId) {
            setAvatarId(defaults.avatarId);
          }
          // Common options
          if (defaults.aspectRatio) {
            const ratioMap: Record<string, CreatifyAspectRatio> = {
              "9:16": "9x16",
              "16:9": "16x9",
              "1:1": "1x1",
            };
            setAspectRatio(ratioMap[defaults.aspectRatio] || "9x16");
          }
          if (defaults.voiceoverVolume !== undefined) {
            setVoiceoverVolume(defaults.voiceoverVolume / 100);
          }
          if (defaults.backgroundMusicVolume !== undefined) {
            setBackgroundMusicVolume(defaults.backgroundMusicVolume / 100);
          }
          if (defaults.voiceId) {
            setVoiceId(defaults.voiceId);
          }
        }
      } catch (error) {
        console.error("Failed to fetch video defaults:", error);
      } finally {
        setIsLoadingDefaults(false);
      }
    }

    fetchDefaults();
  }, []);

  function handleContinue() {
    const localVisualStyle =
      apiMethod === "local" && visualStyle === "FullScreenTemplate"
        ? undefined
        : visualStyle || undefined;

    onComplete({
      apiMethod,
      creatifyStyle: selectedStyle,
      visualStyle: localVisualStyle,
      videoLength,
      avatarId,
      aspectRatio,
      voiceoverVolume,
      backgroundMusicVolume,
      voiceId,
    });
  }

  // Estimate credits based on script length (rough: 150 words/minute, 5 credits per 30 sec)
  const wordCount = script.split(/\s+/).length;
  const estimatedSeconds = Math.ceil((wordCount / 150) * 60);
  const estimatedCredits = Math.ceil(estimatedSeconds / 30) * 5;
  const isLocal = apiMethod === "local";

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Choose Video Style</CardTitle>
          <CardDescription>
            Select the generation method, visual style, and format for your video.
            {isLocal
              ? " Estimated cost: about $0.05 per 30-second video."
              : ` Estimated cost: ~${estimatedCredits} credits (${estimatedSeconds}s video)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* API Method Selection */}
          <div>
            <Label className="text-base font-medium">Generation Method</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Choose how your video will be generated
            </p>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {API_METHODS.map((method) => {
                const Icon = method.icon;
                return (
                  <button
                    key={method.value}
                    onClick={() => {
                      setApiMethod(method.value);
                      if (method.value === "local" && visualStyle === "FullScreenTemplate") {
                        setVisualStyle("");
                      }
                    }}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all",
                      apiMethod === method.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <div>
                      <p className="font-medium">{method.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {method.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Method-specific options */}
          {apiMethod === "ai_shorts" && (
            <div>
              <Label className="text-base font-medium">Visual Style</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Choose how your video will look
              </p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {CREATIFY_STYLES.map((style) => (
                  <button
                    key={style.value}
                    onClick={() => setSelectedStyle(style.value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
                      selectedStyle === style.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <p className="font-medium">{style.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {style.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {apiMethod === "link_to_video" && (
            <>
              <div>
                <Label className="text-base font-medium">Visual Template</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Choose the template style for the generated video
                </p>
                <Select value={visualStyle} onValueChange={setVisualStyle}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TO_VIDEO_VISUAL_STYLES.map((style) => (
                      <SelectItem key={style.value} value={style.value}>
                        {style.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-base font-medium">Video Length</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Target length for the generated video
                </p>
                <Select
                  value={String(videoLength)}
                  onValueChange={(v) => setVideoLength(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select length" />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TO_VIDEO_LENGTHS.map((len) => (
                      <SelectItem key={len.value} value={String(len.value)}>
                        {len.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {apiMethod === "lipsync_v2" && (
            <div>
              <Label className="text-base font-medium">AI Avatar</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Select the avatar that will present your video
              </p>
              <AvatarSelector
                value={avatarId ?? undefined}
                onChange={setAvatarId}
                disabled={isLoadingDefaults}
              />
            </div>
          )}

          {apiMethod === "local" && (
            <>
              <div className="space-y-2">
                <Label>OpenAI Voice</Label>
                <VoiceSelector
                  source="local"
                  value={voiceId || undefined}
                  onChange={(id) => setVoiceId(id)}
                  disabled={isLoadingDefaults}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="local-visual-style">Visual style</Label>
                <Input
                  id="local-visual-style"
                  value={visualStyle === "FullScreenTemplate" ? "" : visualStyle}
                  onChange={(event) => setVisualStyle(event.target.value)}
                  placeholder="e.g. flat paper-cut illustration, warm colors"
                />
              </div>
            </>
          )}

          {/* Aspect Ratio */}
          <div>
            <Label className="text-base font-medium">Aspect Ratio</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Choose based on where you will post the video
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {CREATIFY_ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.value}
                  onClick={() => setAspectRatio(ratio.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all",
                    aspectRatio === ratio.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {/* Visual aspect ratio preview */}
                  <div
                    className={cn(
                      "border-2 border-current",
                      ratio.value === "9x16" && "w-6 h-10",
                      ratio.value === "16x9" && "w-10 h-6",
                      ratio.value === "1x1" && "w-8 h-8"
                    )}
                  />
                  <div className="text-center">
                    <p className="font-medium">{ratio.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {ratio.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Audio Settings */}
          {apiMethod !== "local" && (
          <div className="border-t pt-6 space-y-4">
            <h4 className="font-medium">Audio Settings</h4>

            {/* Voice Selection */}
            <div className="space-y-2">
              <Label>Voice</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Choose the voice for the video narration
              </p>
              <VoiceSelector
                value={voiceId || undefined}
                onChange={(id) => setVoiceId(id)}
                disabled={isLoadingDefaults}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Voiceover Volume</Label>
                <span className="text-sm text-muted-foreground">
                  {Math.round(voiceoverVolume * 100)}%
                </span>
              </div>
              <Slider
                value={[voiceoverVolume]}
                onValueChange={([value]) => setVoiceoverVolume(value)}
                min={0}
                max={1}
                step={0.1}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Background Music Volume</Label>
                <span className="text-sm text-muted-foreground">
                  {Math.round(backgroundMusicVolume * 100)}%
                </span>
              </div>
              <Slider
                value={[backgroundMusicVolume]}
                onValueChange={([value]) => setBackgroundMusicVolume(value)}
                min={0}
                max={1}
                step={0.1}
                className="w-full"
              />
            </div>
          </div>
          )}

          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Script
            </Button>
            <Button onClick={handleContinue}>
              Generate Video
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
