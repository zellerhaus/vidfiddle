"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { MUSIC_OPTIONS, PACING_OPTIONS, type MusicChoice, type VoiceProviderName } from "@/lib/local-engine";
import type { Pacing } from "@/lib/video-engine/types";
import { VoiceSelector } from "@/components/settings/voice-selector";
import { StylePicker } from "@/components/convert/style-picker";
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
  /** Local engine only: who reads the script. */
  voiceProvider?: VoiceProviderName;
  /** Local engine only. */
  pacing?: Pacing;
  /** Local engine only. */
  musicMood?: MusicChoice;
}

interface StyleStepProps {
  script: string;
  /** Choices made earlier in this conversion; they take precedence over the saved defaults. */
  initialOptions?: StyleOptions | null;
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
    description: "Renders on your server with OpenAI voice, images and captions. Needs OPENAI_API_KEY. About $0.06 per 30-second video.",
    icon: Server,
  },
];

type VideoDefaultsResponse = VideoDefaults & {
  capabilities?: {
    creatifyConfigured?: boolean;
    elevenLabsConfigured?: boolean;
    preferredApiMethod?: CreatifyApiMethod;
  };
};

export function StyleStep({ script, initialOptions, onComplete, onBack }: StyleStepProps) {
  const [apiMethod, setApiMethod] = useState<CreatifyApiMethod>("ai_shorts");
  const [selectedStyle, setSelectedStyle] = useState<CreatifyStyle>("4K realistic");
  const [visualStyle, setVisualStyle] = useState("FullScreenTemplate");
  const [videoLength, setVideoLength] = useState(30);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<CreatifyAspectRatio>("9x16");
  const [voiceoverVolume, setVoiceoverVolume] = useState(0.8);
  const [backgroundMusicVolume, setBackgroundMusicVolume] = useState(0.3);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderName>("openai");
  const [elevenLabsConfigured, setElevenLabsConfigured] = useState(false);
  const [pacing, setPacing] = useState<Pacing>("medium");
  const [musicMood, setMusicMood] = useState<MusicChoice>("auto");
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
  // Unknown until defaults load; the AI Shorts, Link to Video and Avatar methods need a Creatify key.
  const [creatifyConfigured, setCreatifyConfigured] = useState<boolean | null>(null);

  // Fetch video defaults on mount
  useEffect(() => {
    async function fetchDefaults() {
      try {
        const response = await fetch("/api/settings/defaults");
        if (response.ok) {
          const defaults: VideoDefaultsResponse = await response.json();
          setCreatifyConfigured(defaults.capabilities?.creatifyConfigured ?? null);
          const hasElevenLabs = defaults.capabilities?.elevenLabsConfigured ?? false;
          setElevenLabsConfigured(hasElevenLabs);
          if (defaults.voiceProvider === "elevenlabs" && hasElevenLabs) {
            setVoiceProvider("elevenlabs");
          }
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
          if (PACING_OPTIONS.some((p) => p.value === defaults.pacing)) {
            setPacing(defaults.pacing as Pacing);
          }
          if (MUSIC_OPTIONS.some((m) => m.value === defaults.musicMood)) {
            setMusicMood(defaults.musicMood as MusicChoice);
          }
          if (initialOptions) {
            restoreOptions(initialOptions, hasElevenLabs);
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

  function restoreOptions(options: StyleOptions, hasElevenLabs: boolean) {
    setApiMethod(options.apiMethod);
    setSelectedStyle(options.creatifyStyle);
    setVisualStyle(options.visualStyle || "FullScreenTemplate");
    if (options.videoLength) setVideoLength(options.videoLength);
    setAvatarId(options.avatarId ?? null);
    setAspectRatio(options.aspectRatio);
    setVoiceoverVolume(options.voiceoverVolume);
    setBackgroundMusicVolume(options.backgroundMusicVolume);
    const provider = options.voiceProvider === "elevenlabs" && hasElevenLabs ? "elevenlabs" : "openai";
    setVoiceProvider(provider);
    // An ElevenLabs voice ID means nothing to the OpenAI picker.
    setVoiceId(provider === (options.voiceProvider ?? "openai") ? options.voiceId : null);
    if (options.pacing) setPacing(options.pacing);
    if (options.musicMood) setMusicMood(options.musicMood);
  }

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
      voiceProvider,
      pacing,
      musicMood,
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
              ? voiceProvider === "elevenlabs"
                ? " Estimated cost: about $0.05 per 30-second video, plus ElevenLabs credits for the voice (about one per character)."
                : " Estimated cost: about $0.06 per 30-second video."
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
                const unavailable = method.value !== "local" && creatifyConfigured === false;
                return (
                  <button
                    key={method.value}
                    disabled={unavailable}
                    title={unavailable ? "Add CREATIFY_API_ID and CREATIFY_API_KEY to use this method" : undefined}
                    onClick={() => {
                      setApiMethod(method.value);
                      if (method.value === "local" && visualStyle === "FullScreenTemplate") {
                        setVisualStyle("");
                      }
                    }}
                    className={cn(
                      "flex flex-col items-start gap-2 border-2 p-4 text-left transition-all disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted disabled:opacity-60 disabled:shadow-none",
                      apiMethod === method.value
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
                      {unavailable && (
                        <p className="label-chrome mt-2 text-[10px]">Needs a Creatify key</p>
                      )}
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
                        ? "border-black bg-primary shadow-hard-sm"
                        : "border-black bg-white hover:bg-accent"
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
              <div>
                <Label className="text-base font-medium">Visual style</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  The look of every scene. Hover a preset to see its prompt.
                </p>
                <StylePicker
                  value={visualStyle === "FullScreenTemplate" ? "" : visualStyle}
                  onChange={setVisualStyle}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Voice</Label>
                  <div className="inline-flex border-2 border-black bg-white p-[2px]" role="radiogroup" aria-label="Voice provider">
                    {(["openai", "elevenlabs"] as const).map((provider) => (
                      <button
                        key={provider}
                        role="radio"
                        aria-checked={voiceProvider === provider}
                        disabled={provider === "elevenlabs" && !elevenLabsConfigured}
                        title={provider === "elevenlabs" && !elevenLabsConfigured ? "Add ELEVENLABS_API_KEY to use ElevenLabs voices" : undefined}
                        onClick={() => {
                          if (provider === voiceProvider) return;
                          setVoiceProvider(provider);
                          setVoiceId(null);
                        }}
                        className={cn(
                          "label-chrome px-3 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40",
                          voiceProvider === provider ? "bg-primary" : "hover:bg-accent"
                        )}
                      >
                        {provider === "openai" ? "OpenAI" : "ElevenLabs"}
                      </button>
                    ))}
                  </div>
                </div>
                <VoiceSelector
                  key={voiceProvider}
                  source={voiceProvider === "elevenlabs" ? "elevenlabs" : "local"}
                  value={voiceId || undefined}
                  onChange={(id) => setVoiceId(id)}
                  disabled={isLoadingDefaults}
                />
                {!elevenLabsConfigured && (
                  <p className="text-xs text-muted-foreground">Add ELEVENLABS_API_KEY to read scripts with ElevenLabs voices.</p>
                )}
              </div>
              <div>
                <Label className="text-base font-medium">Pacing</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  How often the picture changes. Same cost at every pace.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  {PACING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setPacing(option.value)}
                      className={cn(
                        "flex flex-col items-start gap-1 border-2 p-3 text-left transition-all",
                        pacing === option.value
                          ? "border-black bg-primary shadow-hard-sm"
                          : "border-black bg-white hover:bg-accent"
                      )}
                    >
                      <p className="font-bold">{option.label}</p>
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Music</Label>
                  <Select value={musicMood} onValueChange={(value) => setMusicMood(value as MusicChoice)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MUSIC_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {musicMood !== "none" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Music level</Label>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(backgroundMusicVolume * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[backgroundMusicVolume]}
                      onValueChange={([value]) => setBackgroundMusicVolume(value)}
                      min={0.05}
                      max={1}
                      step={0.05}
                      className="w-full pt-3"
                    />
                  </div>
                )}
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
                      ? "border-black bg-primary shadow-hard-sm"
                      : "border-black bg-white hover:bg-accent"
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

          {/* Audio Settings (waits for the defaults, so it doesn't load Creatify voices for a local render) */}
          {apiMethod !== "local" && !isLoadingDefaults && (
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
