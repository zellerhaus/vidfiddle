import { isElevenLabsVoiceId, type LocalEngineOptions } from "@/lib/local-engine";
import type { CostSink, EngineProviders } from "../types";
import { ElevenLabsVoice } from "./elevenlabs";
import { openAIProviders } from "./openai";

/**
 * Stage providers for a local-engine render: OpenAI for planning, images and word timings, and
 * OpenAI or ElevenLabs for the voice. An ElevenLabs choice without a key (or voice) falls back to
 * the OpenAI voice with a warning, so a missing key never stops Auto Mode.
 */
export function localEngineProviders(
  options: Pick<LocalEngineOptions, "voiceProvider" | "voice"> | null | undefined,
  env: Record<string, string | undefined> = process.env
): (costs: CostSink) => EngineProviders {
  const elevenLabs = options?.voiceProvider === "elevenlabs";
  const base = openAIProviders({
    apiKey: env.OPENAI_API_KEY!,
    voice: elevenLabs ? undefined : options?.voice,
    textModel: env.OPENAI_TEXT_MODEL,
    imageModel: env.OPENAI_IMAGE_MODEL,
  });
  if (!elevenLabs) return base;

  const voiceId = options?.voice || env.ELEVENLABS_VOICE_ID;
  if (!env.ELEVENLABS_API_KEY || !isElevenLabsVoiceId(voiceId)) {
    console.warn("[engine] ElevenLabs voice chosen but ELEVENLABS_API_KEY or a voice ID is missing; using the OpenAI voice");
    return base;
  }
  return (costs) => ({
    ...base(costs),
    voice: new ElevenLabsVoice({ apiKey: env.ELEVENLABS_API_KEY!, voiceId, model: env.ELEVENLABS_TTS_MODEL }, costs),
  });
}
