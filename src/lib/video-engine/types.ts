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

export interface Scene {
  /** Verbatim slice of the script, spoken over this scene. */
  narration: string;
  /** Prompt for the scene's still image. */
  visual: string;
}

export interface ScenePlan {
  /** Shared art direction applied to every scene's image. */
  style: string;
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

export interface EngineProviders {
  planner: ScenePlanner;
  voice: VoiceProvider;
  visuals: VisualProvider;
  transcriber: Transcriber;
}

export interface CostSink {
  add(line: CostLine): void;
}
