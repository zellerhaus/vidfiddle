"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Film, Link2, Server, User } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceSelector } from "./voice-selector";
import { AvatarSelector } from "./avatar-selector";
import { cn } from "@/lib/utils";
import {
  LINK_TO_VIDEO_VISUAL_STYLES,
  LINK_TO_VIDEO_LENGTHS,
} from "@/lib/creatify";
import type { VideoDefaults, CreatifyApiMethod } from "@/lib/supabase/types";

// Creatify style options (for ai_shorts)
const CREATIFY_STYLES = [
  { value: "stock_footage", label: "Stock Footage" },
  { value: "ai_avatar", label: "AI Avatar" },
  { value: "text_on_screen", label: "Text on Screen" },
  { value: "product_showcase", label: "Product Showcase" },
  { value: "explainer", label: "Explainer" },
  { value: "testimonial", label: "Testimonial" },
  { value: "tutorial", label: "Tutorial" },
  { value: "promo", label: "Promotional" },
  { value: "story", label: "Story" },
  { value: "comparison", label: "Comparison" },
];

const ASPECT_RATIOS = [
  { value: "9:16", label: "9:16 (Vertical)" },
  { value: "16:9", label: "16:9 (Horizontal)" },
  { value: "1:1", label: "1:1 (Square)" },
];

const SCRIPT_STYLES = [
  { value: "engaging", label: "Engaging" },
  { value: "educational", label: "Educational" },
  { value: "storytelling", label: "Storytelling" },
  { value: "listicle", label: "Listicle" },
  { value: "how_to", label: "How-To" },
];

const SCRIPT_TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "humorous", label: "Humorous" },
  { value: "inspirational", label: "Inspirational" },
  { value: "urgent", label: "Urgent" },
];

const API_METHODS: { value: CreatifyApiMethod; label: string; description: string; icon: React.ElementType }[] = [
  { value: "ai_shorts", label: "AI Shorts", description: "Stock footage with AI-generated visuals", icon: Film },
  { value: "link_to_video", label: "Link to Video", description: "Video from blog URL with templates", icon: Link2 },
  { value: "lipsync_v2", label: "AI Avatar", description: "Avatar-based videos with lip sync", icon: User },
  {
    value: "local",
    label: "Local engine (OpenAI)",
    description: "Renders on your server with OpenAI voice, images and captions. Needs OPENAI_API_KEY. About $0.05 per 30-second video.",
    icon: Server,
  },
];

const DEFAULT_VALUES: VideoDefaults = {
  apiMethod: "ai_shorts",
  creatifyStyle: "stock_footage",
  visualStyle: "FullScreenTemplate",
  videoLength: 30,
  avatarId: null,
  aspectRatio: "9:16",
  voiceId: null,
  voiceoverVolume: 80,
  backgroundMusicVolume: 30,
  targetDuration: 60,
  scriptStyle: "engaging",
  scriptTone: "professional",
};

type VideoDefaultsResponse = VideoDefaults & {
  capabilities?: {
    preferredApiMethod?: CreatifyApiMethod;
  };
};

export function VideoDefaultsForm() {
  const [defaults, setDefaults] = React.useState<VideoDefaults>(DEFAULT_VALUES);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  // Load current defaults on mount
  React.useEffect(() => {
    async function loadDefaults() {
      try {
        const response = await fetch("/api/settings/defaults");
        if (!response.ok) {
          throw new Error("Failed to load defaults");
        }
        const data: VideoDefaultsResponse = await response.json();
        // Backfill apiMethod for legacy settings that don't have it
        if (!data.apiMethod) {
          data.apiMethod = data.capabilities?.preferredApiMethod || "ai_shorts";
        }
        setDefaults(data);
      } catch (error) {
        console.error("Error loading defaults:", error);
        toast.error("Failed to load video defaults");
      } finally {
        setIsLoading(false);
      }
    }
    loadDefaults();
  }, []);

  // Save defaults
  async function handleSave() {
    setIsSaving(true);
    try {
      const response = await fetch("/api/settings/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save defaults");
      }

      toast.success("Video defaults saved successfully");
    } catch (error) {
      console.error("Error saving defaults:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save defaults"
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* API Method Selection */}
      <div className="space-y-2">
        <Label className="text-base font-medium">Video Generation Method</Label>
        <p className="text-sm text-muted-foreground">
          Choose how videos should be generated
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {API_METHODS.map((method) => {
            const Icon = method.icon;
            return (
              <button
                key={method.value}
                onClick={() =>
                  setDefaults((prev) => ({
                    ...prev,
                    apiMethod: method.value,
                    visualStyle:
                      method.value === "local" &&
                      prev.visualStyle === "FullScreenTemplate"
                        ? undefined
                        : prev.visualStyle,
                  }))
                }
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all",
                  defaults.apiMethod === method.value
                    ? "border-black bg-primary shadow-hard-sm"
                    : "border-black bg-white hover:bg-accent"
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
      {defaults.apiMethod === "ai_shorts" && (
        <div className="space-y-2">
          <Label htmlFor="creatify-style">Creatify Style</Label>
          <Select
            value={defaults.creatifyStyle}
            onValueChange={(value) =>
              setDefaults((prev) => ({ ...prev, creatifyStyle: value }))
            }
          >
            <SelectTrigger id="creatify-style">
              <SelectValue placeholder="Select style" />
            </SelectTrigger>
            <SelectContent>
              {CREATIFY_STYLES.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  {style.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {defaults.apiMethod === "link_to_video" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="visual-style">Visual Template</Label>
            <p className="text-sm text-muted-foreground">
              Choose the visual template for the generated video
            </p>
            <Select
              value={defaults.visualStyle || "FullScreenTemplate"}
              onValueChange={(value) =>
                setDefaults((prev) => ({ ...prev, visualStyle: value }))
              }
            >
              <SelectTrigger id="visual-style">
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
          <div className="space-y-2">
            <Label htmlFor="video-length">Video Length</Label>
            <Select
              value={String(defaults.videoLength || 30)}
              onValueChange={(value) =>
                setDefaults((prev) => ({ ...prev, videoLength: Number(value) }))
              }
            >
              <SelectTrigger id="video-length">
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

      {defaults.apiMethod === "lipsync_v2" && (
        <div className="space-y-2">
          <Label>Avatar</Label>
          <p className="text-sm text-muted-foreground">
            Choose the AI avatar for lip-synced videos
          </p>
          <AvatarSelector
            value={defaults.avatarId ?? undefined}
            onChange={(avatarId) =>
              setDefaults((prev) => ({ ...prev, avatarId }))
            }
          />
        </div>
      )}

      {defaults.apiMethod === "local" && (
        <>
          <div className="space-y-2">
            <Label>OpenAI Voice</Label>
            <VoiceSelector
              source="local"
              value={defaults.voiceId ?? undefined}
              onChange={(voiceId) =>
                setDefaults((prev) => ({ ...prev, voiceId }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="local-visual-style">Visual style</Label>
            <Input
              id="local-visual-style"
              value={defaults.visualStyle === "FullScreenTemplate" ? "" : defaults.visualStyle ?? ""}
              onChange={(event) =>
                setDefaults((prev) => ({
                  ...prev,
                  visualStyle: event.target.value || undefined,
                }))
              }
              placeholder="e.g. flat paper-cut illustration, warm colors"
            />
          </div>
        </>
      )}

      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label htmlFor="aspect-ratio">Aspect Ratio</Label>
        <Select
          value={defaults.aspectRatio}
          onValueChange={(value: "9:16" | "16:9" | "1:1") =>
            setDefaults((prev) => ({ ...prev, aspectRatio: value }))
          }
        >
          <SelectTrigger id="aspect-ratio">
            <SelectValue placeholder="Select aspect ratio" />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((ratio) => (
              <SelectItem key={ratio.value} value={ratio.value}>
                {ratio.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {defaults.apiMethod !== "local" && (
        <>
          {/* Voice Selector */}
          <div className="space-y-2">
            <Label>Voice</Label>
            <VoiceSelector
              value={defaults.voiceId ?? undefined}
              onChange={(voiceId) =>
                setDefaults((prev) => ({ ...prev, voiceId }))
              }
            />
          </div>

          {/* Voiceover Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="voiceover-volume">Voiceover Volume</Label>
              <span className="text-sm text-muted-foreground">
                {defaults.voiceoverVolume}%
              </span>
            </div>
            <Slider
              id="voiceover-volume"
              value={[defaults.voiceoverVolume]}
              onValueChange={([value]) =>
                setDefaults((prev) => ({ ...prev, voiceoverVolume: value }))
              }
              min={0}
              max={100}
              step={5}
            />
          </div>

          {/* Background Music Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="bg-music-volume">Background Music Volume</Label>
              <span className="text-sm text-muted-foreground">
                {defaults.backgroundMusicVolume}%
              </span>
            </div>
            <Slider
              id="bg-music-volume"
              value={[defaults.backgroundMusicVolume]}
              onValueChange={([value]) =>
                setDefaults((prev) => ({ ...prev, backgroundMusicVolume: value }))
              }
              min={0}
              max={100}
              step={5}
            />
          </div>
        </>
      )}

      {/* Target Duration */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="target-duration">Target Duration</Label>
          <span className="text-sm text-muted-foreground">
            {defaults.targetDuration}s
          </span>
        </div>
        <Slider
          id="target-duration"
          value={[defaults.targetDuration]}
          onValueChange={([value]) =>
            setDefaults((prev) => ({ ...prev, targetDuration: value }))
          }
          min={30}
          max={90}
          step={5}
        />
      </div>

      {/* Script Style */}
      <div className="space-y-2">
        <Label htmlFor="script-style">Script Style</Label>
        <Select
          value={defaults.scriptStyle}
          onValueChange={(value) =>
            setDefaults((prev) => ({ ...prev, scriptStyle: value }))
          }
        >
          <SelectTrigger id="script-style">
            <SelectValue placeholder="Select script style" />
          </SelectTrigger>
          <SelectContent>
            {SCRIPT_STYLES.map((style) => (
              <SelectItem key={style.value} value={style.value}>
                {style.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Script Tone */}
      <div className="space-y-2">
        <Label htmlFor="script-tone">Script Tone</Label>
        <Select
          value={defaults.scriptTone}
          onValueChange={(value) =>
            setDefaults((prev) => ({ ...prev, scriptTone: value }))
          }
        >
          <SelectTrigger id="script-tone">
            <SelectValue placeholder="Select script tone" />
          </SelectTrigger>
          <SelectContent>
            {SCRIPT_TONES.map((tone) => (
              <SelectItem key={tone.value} value={tone.value}>
                {tone.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Save Button */}
      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save Defaults
      </Button>
    </div>
  );
}
