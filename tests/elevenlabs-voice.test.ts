import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildLocalEngineOptions } from "../src/lib/local-engine";
import { localEngineProviders } from "../src/lib/video-engine/providers";
import { ElevenLabsVoice } from "../src/lib/video-engine/providers/elevenlabs";
import type { CostLine } from "../src/lib/video-engine/types";

async function withFetch(handler: (url: string, init: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("ElevenLabs voice sends neighboring scenes for continuity and records credits", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vidfiddle-el-"));
  const costs: CostLine[] = [];
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  try {
    await withFetch(
      (url, init) => {
        requests.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
      async () => {
        const voice = new ElevenLabsVoice({ apiKey: "el-key", voiceId: "bxiObU1YDrf7lrFAyV99" }, { add: (c) => costs.push(c) });
        await voice.speak("Meet Vidfiddle.", path.join(dir, "scene.mp3"), { previous: "Your blog already wrote it.", next: "Point it at a feed." });
      }
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/v1\/text-to-speech\/bxiObU1YDrf7lrFAyV99\?output_format=mp3_44100_128$/);
    assert.equal(requests[0].headers.get("xi-api-key"), "el-key");
    assert.deepEqual(requests[0].body, {
      text: "Meet Vidfiddle.",
      model_id: "eleven_multilingual_v2",
      previous_text: "Your blog already wrote it.",
      next_text: "Point it at a feed.",
    });
    assert.deepEqual([...(await readFile(path.join(dir, "scene.mp3")))], [1, 2, 3]);
    assert.equal(costs[0].credits, "Meet Vidfiddle.".length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ElevenLabs voice retries a rate limit before giving up", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vidfiddle-el-"));
  let calls = 0;
  try {
    await withFetch(
      () => (++calls === 1 ? new Response("busy", { status: 429 }) : new Response(new Uint8Array([9]), { status: 200 })),
      async () => {
        const voice = new ElevenLabsVoice({ apiKey: "k", voiceId: "abcdefgh12" }, { add: () => {} });
        await voice.speak("Hi.", path.join(dir, "a.mp3"));
      }
    );
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ElevenLabs options keep valid voice IDs only, and fall back to OpenAI without a key", () => {
  const options = buildLocalEngineOptions({ voiceProvider: "elevenlabs", voice: "bxiObU1YDrf7lrFAyV99" });
  assert.equal(options.voiceProvider, "elevenlabs");
  assert.equal(options.voice, "bxiObU1YDrf7lrFAyV99");
  assert.equal(buildLocalEngineOptions({ voiceProvider: "elevenlabs", voice: "../../etc" }).voice, undefined);
  assert.equal(buildLocalEngineOptions({ voice: "nova" }).voiceProvider, "openai");

  const sink = { add: () => {} };
  const keyed = localEngineProviders(options, { OPENAI_API_KEY: "o", ELEVENLABS_API_KEY: "e" })(sink);
  assert.ok(keyed.voice instanceof ElevenLabsVoice);
  const unkeyed = localEngineProviders(options, { OPENAI_API_KEY: "o" })(sink);
  assert.ok(!(unkeyed.voice instanceof ElevenLabsVoice));
});
