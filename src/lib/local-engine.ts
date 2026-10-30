/**
 * Contract between the app and the worker for videos rendered by the local engine
 * (src/lib/video-engine). The app inserts a `videos` row with status "pending" and these
 * style options; the worker claims it, renders it, and moves it to review.
 */
import { MOODS, type AspectRatio, type Mood, type Pacing } from "@/lib/video-engine/types";

/** "auto" lets the planner pick the mood; "none" renders without music. */
export type MusicChoice = Mood | "auto" | "none";

export type VoiceProviderName = "openai" | "elevenlabs";

/** ElevenLabs voice IDs are short alphanumeric strings; anything else never reaches a URL. */
export function isElevenLabsVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{8,40}$/.test(value);
}

// A type alias, not an interface, so it satisfies the JSON column type when inserted.
export type LocalEngineOptions = {
  apiVersion: "local";
  aspectRatio: AspectRatio;
  /** Who reads the script. Missing means "openai". */
  voiceProvider?: VoiceProviderName;
  /** An OpenAI voice from OPENAI_VOICES, or an ElevenLabs voice ID. */
  voice?: string;
  /** Art direction applied to every scene image. Omit to let the planner choose. */
  visualStyle?: string;
  /** How often the picture changes. Missing means "medium". */
  pacing?: Pacing;
  /** Background music. Missing means "auto". */
  music?: MusicChoice;
  /** Music level, 0–1 (the app's music slider). Missing means 0.3. */
  musicVolume?: number;
};

export const PACING_OPTIONS: { value: Pacing; label: string; description: string }[] = [
  { value: "slow", label: "Slow", description: "A new picture about every 8 seconds" },
  { value: "medium", label: "Medium", description: "A new shot about every 4 seconds" },
  { value: "fast", label: "Fast", description: "A new shot every 2–3 seconds" },
];

export const MUSIC_OPTIONS: { value: MusicChoice; label: string }[] = [
  { value: "auto", label: "Match the script" },
  ...MOODS.map((mood) => ({ value: mood, label: mood[0].toUpperCase() + mood.slice(1) })),
  { value: "none", label: "No music" },
];

export function toPacing(value: string | null | undefined): Pacing {
  return value === "slow" || value === "fast" ? value : "medium";
}

export function toMusicChoice(value: string | null | undefined): MusicChoice {
  return MUSIC_OPTIONS.some((option) => option.value === value) ? (value as MusicChoice) : "auto";
}

/** Style options for a local-engine video, from loosely typed request or settings values. */
export function buildLocalEngineOptions(input: {
  aspectRatio?: string;
  voiceProvider?: string | null;
  voice?: string | null;
  visualStyle?: string | null;
  pacing?: string | null;
  music?: string | null;
  musicVolume?: number | null;
}): LocalEngineOptions {
  const elevenLabs = input.voiceProvider === "elevenlabs";
  return {
    apiVersion: "local",
    aspectRatio: toAspectRatio(input.aspectRatio),
    voiceProvider: elevenLabs ? "elevenlabs" : "openai",
    voice: elevenLabs ? (isElevenLabsVoiceId(input.voice) ? input.voice : undefined) : toOpenAIVoice(input.voice),
    visualStyle: input.visualStyle && input.visualStyle !== "FullScreenTemplate" ? input.visualStyle : undefined,
    pacing: toPacing(input.pacing),
    music: toMusicChoice(input.music),
    musicVolume:
      typeof input.musicVolume === "number" && Number.isFinite(input.musicVolume)
        ? Math.min(1, Math.max(0, input.musicVolume))
        : undefined,
  };
}

/** Voices supported by gpt-4o-mini-tts. */
export const OPENAI_VOICES = [
  { value: "coral", label: "Coral", description: "Warm, upbeat" },
  { value: "alloy", label: "Alloy", description: "Neutral, balanced" },
  { value: "ash", label: "Ash", description: "Clear, direct" },
  { value: "ballad", label: "Ballad", description: "Soft, expressive" },
  { value: "echo", label: "Echo", description: "Calm, resonant" },
  { value: "fable", label: "Fable", description: "Storyteller" },
  { value: "nova", label: "Nova", description: "Bright, friendly" },
  { value: "onyx", label: "Onyx", description: "Deep, authoritative" },
  { value: "sage", label: "Sage", description: "Thoughtful, even" },
  { value: "shimmer", label: "Shimmer", description: "Light, energetic" },
  { value: "verse", label: "Verse", description: "Dynamic, conversational" },
] as const;

export function isLocalEngineConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function isLocalEngineOptions(value: unknown): value is LocalEngineOptions {
  return typeof value === "object" && value !== null && (value as { apiVersion?: unknown }).apiVersion === "local";
}

export function toOpenAIVoice(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return OPENAI_VOICES.some((voice) => voice.value === value) ? value : undefined;
}

/** Accepts the app's "9:16" or the engine's "9x16" spelling. */
export function toAspectRatio(value: string | undefined): AspectRatio {
  const normalized = (value ?? "9x16").replace(":", "x");
  return normalized === "16x9" || normalized === "1x1" ? normalized : "9x16";
}
