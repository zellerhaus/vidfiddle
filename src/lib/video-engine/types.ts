/**
 * Local video engine: turns a narration script into a finished MP4 on this
 * machine. Each stage sits behind a small interface so providers can be
 * swapped (OpenAI today; ElevenLabs voices or Pexels footage later).
 */

export type AspectRatio = "9x16" | "16x9" | "1x1";

export const OUTPUT_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  "9x16": { width: 1080, height: 1920 },
  "16x9": { width: 1920, height: 1080 },
  "1x1": { width: 1080, height: 1080 },
};

/** How often the picture changes. Medium and fast cut each scene's image into shots of about
 * this many seconds; slow holds one shot per scene. */
export type Pacing = "slow" | "medium" | "fast";
export const SHOT_SECONDS: Record<Pacing, number | null> = { slow: null, medium: 4, fast: 2.5 };
/** One base camera move plus up to three punch-ins per image, so shots don't repeat. */
export const MAX_SHOTS_PER_SCENE = 4;

/** Background music moods. The planner picks one per video; library tracks are filed under one. */
export const MOODS = ["upbeat", "calm", "inspiring", "dramatic", "playful"] as const;
export type Mood = (typeof MOODS)[number];

export interface Scene {
  /** Verbatim slice of the script, spoken over this scene. */
  narration: string;
  /** Prompt for the scene's still image. */
  visual: string;
}

export interface ScenePlan {
  /** Shared art direction applied to every scene's image. */
  style: string;
  /** Music mood that fits the script. Missing from plans saved before music existed. */
  mood?: Mood;
  scenes: Scene[];
}

export interface Word {
  word: string;
  /** Seconds from the start of the audio file. */
  start: number;
  end: number;
}

export interface CostLine {
  stage: "plan" | "voice" | "visual" | "transcribe";
  model: string;
  usd: number;
  /** True when the provider doesn't report usage and the cost is computed from duration. */
  estimated?: boolean;
}

export interface ScenePlanner {
  plan(narrations: string[], opts: { aspect: AspectRatio; style?: string }): Promise<ScenePlan>;
}

export interface VoiceProvider {
  /** Writes speech for `text` to `outFile` (mp3). */
  speak(text: string, outFile: string): Promise<void>;
}

export interface VisualProvider {
  /** Writes a still image for `prompt` to `outFile` (png). */
  still(prompt: string, aspect: AspectRatio, outFile: string): Promise<void>;
}

export interface Transcriber {
  words(audioFile: string): Promise<Word[]>;
}

export interface MusicProvider {
  /** Returns an audio file to use as the video's music bed, or null when none is available. */
  track(opts: { mood: Mood; style: string; seconds: number; workDir: string }): Promise<string | null>;
}

export interface EngineProviders {
  planner: ScenePlanner;
  voice: VoiceProvider;
  visuals: VisualProvider;
  transcriber: Transcriber;
}

export interface CostSink {
  add(line: CostLine): void;
}
