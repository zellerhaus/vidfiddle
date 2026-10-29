/**
 * Contract between the app and the worker for videos rendered by the local engine
 * (src/lib/video-engine). The app inserts a `videos` row with status "pending" and these
 * style options; the worker claims it, renders it, and moves it to review.
 */
import type { AspectRatio } from "@/lib/video-engine/types";

export interface LocalEngineOptions {
  apiVersion: "local";
  aspectRatio: AspectRatio;
  /** An OpenAI voice from OPENAI_VOICES. */
  voice?: string;
  /** Art direction applied to every scene image. Omit to let the planner choose. */
  visualStyle?: string;
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
