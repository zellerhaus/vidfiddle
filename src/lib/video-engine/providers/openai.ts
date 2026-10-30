import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  AspectRatio,
  CostSink,
  EngineProviders,
  ScenePlan,
  ScenePlanner,
  Transcriber,
  VisualProvider,
  VoiceProvider,
  Word,
} from "../types";
import { probeDuration } from "../ffmpeg";

// Standard-tier list prices, $ per 1M tokens (developers.openai.com/api/docs/pricing, Oct 2026).
// Unknown models record $0 and are flagged as estimated.
const TEXT_PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-6.1-terra": { in: 1, cached: 0.05, out: 5 },
  "gpt-6.1-sol": { in: 2, cached: 0.1, out: 10 },
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
  "gpt-5.5": { in: 5, cached: 0.5, out: 30 },
};
const IMAGE_PRICES = { textIn: 5, imageIn: 8, imageOut: 30 }; // gpt-image-2.5-*
// The speech endpoint returns no usage, so voice is costed per minute of audio.
const TTS_PER_MINUTE = 0.015;
const WHISPER_PER_MINUTE = 0.006;

const IMAGE_SIZE: Record<AspectRatio, string> = {
  "9x16": "1024x1536",
  "16x9": "1536x1024",
  "1x1": "1024x1024",
};

export interface OpenAIEngineConfig {
  apiKey: string;
  textModel?: string;
  imageModel?: string;
  imageQuality?: "low" | "medium" | "high";
  voiceModel?: string;
  voice?: string;
  /** Delivery direction for the narrator, passed to gpt-4o-mini-tts. */
  voiceInstructions?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(apiKey: string, path: string, body: BodyInit, json: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: json
        ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(300_000),
    });
    if (res.ok) return res;
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5 || /insufficient_quota|billing/i.test(text)) {
      throw new Error(`OpenAI ${path} failed: ${res.status} ${text.slice(0, 400)}`);
    }
    const hinted = Number(res.headers.get("retry-after")) * 1000 || 0;
    await sleep(Math.max(hinted, 1000 * 2 ** attempt * (0.5 + Math.random())));
  }
}

const postJson = (apiKey: string, path: string, body: unknown) =>
  call(apiKey, path, JSON.stringify(body), true);

class OpenAIPlanner implements ScenePlanner {
  constructor(
    private cfg: OpenAIEngineConfig,
    private costs: CostSink
  ) {}

  async plan(narrations: string[], opts: { aspect: AspectRatio; style?: string }): Promise<ScenePlan> {
    const model = this.cfg.textModel ?? "gpt-6.1-terra";
    const orientation = { "9x16": "vertical 9:16", "16x9": "horizontal 16:9", "1x1": "square" }[opts.aspect];
    const res = await postJson(this.cfg.apiKey, "responses", {
      model,
      input: [
        {
          role: "system",
          content:
            "You are the art director for a short narrated social video. Each scene is one still image " +
            "shown while its narration plays. Write one image prompt per scene that shows the idea " +
            "concretely: a specific subject, setting, lighting and camera framing. Never put text, " +
            "letters, numbers, logos, captions or UI in an image. Never depict a real, identifiable " +
            "person, a celebrity, or a famous fictional character, and don't describe costumes that " +
            "imitate one; use generic figures instead. " +
            `Compose for a ${orientation} frame with the subject centered, because the frame ` +
            "slowly zooms and the lower third is covered by captions. All scenes share one visual style: " +
            "write every prompt in that style's own terms (medium, texture, palette), and describe a " +
            "photograph or camera only when the style is photographic.",
        },
        {
          role: "user",
          content:
            (opts.style
              ? `Visual style (use it as given): ${opts.style}\n\n`
              : "Choose a visual style that fits the topic and describe it in one sentence.\n\n") +
            narrations.map((n, i) => `Scene ${i + 1}: ${n}`).join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["style", "visuals"],
            properties: {
              style: { type: "string" },
              visuals: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });
    const raw = await res.json();
    const usage = raw.usage ?? {};
    const price = TEXT_PRICES[model];
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    this.costs.add({
      stage: "plan",
      model,
      usd: price
        ? (((usage.input_tokens ?? 0) - cached) * price.in + cached * price.cached + (usage.output_tokens ?? 0) * price.out) / 1e6
        : 0,
      estimated: !price,
    });

    const message = (raw.output ?? []).find((o: { type: string }) => o.type === "message");
    const text = message?.content?.find((c: { type: string }) => c.type === "output_text")?.text;
    if (!text) throw new Error("Scene planner returned no output");
    const parsed = JSON.parse(text) as { style: string; visuals: string[] };

    // The model occasionally returns one prompt too many or too few; pad with the last prompt
    // rather than fail the render.
    const visuals = narrations.map((_, i) => parsed.visuals[i] ?? parsed.visuals.at(-1) ?? narrations[i]);
    return {
      style: opts.style ?? parsed.style,
      scenes: narrations.map((narration, i) => ({ narration, visual: visuals[i] })),
    };
  }
}

class OpenAIVoice implements VoiceProvider {
  constructor(
    private cfg: OpenAIEngineConfig,
    private costs: CostSink
  ) {}

  async speak(text: string, outFile: string): Promise<void> {
    const model = this.cfg.voiceModel ?? "gpt-4o-mini-tts";
    const res = await postJson(this.cfg.apiKey, "audio/speech", {
      model,
      voice: this.cfg.voice ?? "coral",
      input: text,
      instructions:
        this.cfg.voiceInstructions ??
        "Warm, confident narrator for a short social video. Clear and lively, natural pace, no long pauses.",
      response_format: "mp3",
    });
    await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
    const seconds = await probeDuration(outFile);
    this.costs.add({ stage: "voice", model, usd: (seconds / 60) * TTS_PER_MINUTE, estimated: true });
  }
}

class OpenAIImages implements VisualProvider {
  constructor(
    private cfg: OpenAIEngineConfig,
    private costs: CostSink
  ) {}

  async still(prompt: string, aspect: AspectRatio, outFile: string): Promise<void> {
    const model = this.cfg.imageModel ?? "gpt-image-2.5-sunburst";
    const res = await postJson(this.cfg.apiKey, "images/generations", {
      model,
      prompt,
      size: IMAGE_SIZE[aspect],
      quality: this.cfg.imageQuality ?? "medium",
      n: 1,
    });
    const raw = await res.json();
    const b64 = raw.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no image");
    await writeFile(outFile, Buffer.from(b64, "base64"));
    const u = raw.usage ?? {};
    const d = u.input_tokens_details ?? {};
    this.costs.add({
      stage: "visual",
      model,
      usd:
        ((d.text_tokens ?? u.input_tokens ?? 0) * IMAGE_PRICES.textIn +
          (d.image_tokens ?? 0) * IMAGE_PRICES.imageIn +
          (u.output_tokens ?? 0) * IMAGE_PRICES.imageOut) /
        1e6,
    });
  }
}

class OpenAITranscriber implements Transcriber {
  constructor(
    private cfg: OpenAIEngineConfig,
    private costs: CostSink
  ) {}

  async words(audioFile: string): Promise<Word[]> {
    // whisper-1 is the OpenAI transcription model that returns word-level timestamps.
    const form = new FormData();
    form.append("file", new Blob([await readFile(audioFile)], { type: "audio/mpeg" }), basename(audioFile));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const raw = await (await call(this.cfg.apiKey, "audio/transcriptions", form, false)).json();
    this.costs.add({
      stage: "transcribe",
      model: "whisper-1",
      usd: ((raw.duration ?? 0) / 60) * WHISPER_PER_MINUTE,
      estimated: true,
    });
    return (raw.words ?? []).map((w: Word) => ({ word: w.word.trim(), start: w.start, end: w.end }));
  }
}

/** Every stage on one OpenAI key: scene planning, voice, images, and caption timing. */
export function openAIProviders(cfg: OpenAIEngineConfig): (costs: CostSink) => EngineProviders {
  return (costs) => ({
    planner: new OpenAIPlanner(cfg, costs),
    voice: new OpenAIVoice(cfg, costs),
    visuals: new OpenAIImages(cfg, costs),
    transcriber: new OpenAITranscriber(cfg, costs),
  });
}
