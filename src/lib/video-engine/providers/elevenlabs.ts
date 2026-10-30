import { writeFile } from "node:fs/promises";
import type { CostSink, VoiceProvider } from "../types";

/**
 * ElevenLabs narration for the local engine. Scenes are voiced one at a time, so each request
 * carries the neighboring scenes' text (`previous_text` / `next_text`); without it every scene is
 * read as a standalone sentence and the delivery sounds stilted. ElevenLabs bills in credits
 * (about one per character on the multilingual models), recorded on each cost line.
 */

export interface ElevenLabsVoiceConfig {
  apiKey: string;
  voiceId: string;
  /** Defaults to eleven_multilingual_v2, which supports previous_text / next_text. */
  model?: string;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class ElevenLabsVoice implements VoiceProvider {
  constructor(
    private cfg: ElevenLabsVoiceConfig,
    private costs: CostSink
  ) {}

  async speak(text: string, outFile: string, context?: { previous?: string; next?: string }): Promise<void> {
    const model = this.cfg.model ?? "eleven_multilingual_v2";
    const body = JSON.stringify({
      text,
      model_id: model,
      ...(context?.previous ? { previous_text: context.previous } : {}),
      ...(context?.next ? { next_text: context.next } : {}),
    });
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.cfg.voiceId)}?output_format=mp3_44100_128`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": this.cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body,
      });
      if (res.ok) {
        await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
        this.costs.add({ stage: "voice", model: `elevenlabs:${model}`, usd: 0, credits: text.length, estimated: true });
        return;
      }
      const detail = (await res.text()).slice(0, 300);
      if (!RETRYABLE.has(res.status) || attempt >= 4) {
        throw new Error(`ElevenLabs speech ${res.status}: ${detail}`);
      }
      // Concurrent scenes can hit the plan's request limit; back off and retry.
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

export interface ElevenLabsVoiceInfo {
  id: string;
  name: string;
  accent: string | null;
  gender: string | null;
  description: string | null;
  previewUrl: string | null;
}

/** Voices available to the key: the account's own voices plus ElevenLabs' defaults. */
export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoiceInfo[]> {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    voices: { voice_id: string; name: string; labels?: Record<string, string>; description?: string | null; preview_url?: string | null }[];
  };
  return data.voices
    .map((v) => ({
      id: v.voice_id,
      name: v.name,
      accent: v.labels?.accent ?? null,
      gender: v.labels?.gender ?? null,
      description: v.labels?.descriptive ?? v.labels?.description ?? v.description ?? null,
      previewUrl: v.preview_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
