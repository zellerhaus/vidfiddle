import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildLocalEngineOptions } from "../src/lib/local-engine";
import { listTracks, moodOf, pickTrack } from "../src/lib/video-engine/music";
import { shotLengths, shotsForScene } from "../src/lib/video-engine/pipeline";

test("pacing sets shots per scene from a target shot length", () => {
  assert.equal(shotsForScene(8, "slow"), 1);
  assert.equal(shotsForScene(8, "medium"), 2);
  assert.equal(shotsForScene(8, "fast"), 3);
  assert.equal(shotsForScene(2, "fast"), 1);
  // Long scenes stop at four framings so shots don't repeat.
  assert.equal(shotsForScene(20, "fast"), 4);
});

test("shot cuts land on nearby word starts and never make flicker-short shots", () => {
  const words = [0, 0.4, 1.1, 1.9, 2.6, 3.3, 4.2, 5.0, 5.7].map((start) => ({ word: "w", start, end: start + 0.3 }));
  const shots = shotLengths(6, 2, words);
  assert.equal(shots.length, 2);
  assert.ok(Math.abs(shots[0] - 3.3) < 1e-9, `cut should snap to the word at 3.3s, got ${shots[0]}`);
  assert.ok(Math.abs(shots.reduce((a, b) => a + b, 0) - 6) < 1e-9);
  // A 2s scene can't hold three shots of at least 1.2s.
  assert.deepEqual(shotLengths(2, 3, []).length, 1);
});

test("library tracks take their mood from a folder or a file-name prefix", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vidfiddle-music-"));
  try {
    await mkdir(path.join(root, "calm"));
    await writeFile(path.join(root, "calm", "rain.mp3"), "x");
    await writeFile(path.join(root, "upbeat-groove.mp3"), "x");
    await writeFile(path.join(root, "untagged.wav"), "x");
    await writeFile(path.join(root, "notes.txt"), "not audio");
    const tracks = await listTracks([root, path.join(root, "missing")]);
    assert.deepEqual(
      tracks.map((t) => [path.relative(root, t.file), t.mood]),
      [["calm/rain.mp3", "calm"], ["untagged.wav", null], ["upbeat-groove.mp3", "upbeat"]]
    );
    assert.equal(moodOf(path.join(root, "dramatic_drums.mp3"), root), "dramatic");
    assert.equal(pickTrack(tracks, "calm", "video-1")?.mood, "calm");
    // No track for the mood: fall back to any track rather than silence.
    assert.ok(pickTrack(tracks, "playful", "video-1"));
    assert.equal(pickTrack([], "calm", "video-1"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local engine options normalize pacing, music and volume", () => {
  const options = buildLocalEngineOptions({ aspectRatio: "16:9", voice: "nova", pacing: "fast", music: "calm", musicVolume: 1.4 });
  assert.equal(options.aspectRatio, "16x9");
  assert.equal(options.pacing, "fast");
  assert.equal(options.music, "calm");
  assert.equal(options.musicVolume, 1);
  const fallback = buildLocalEngineOptions({ pacing: "warp", music: "metal", visualStyle: "FullScreenTemplate" });
  assert.equal(fallback.pacing, "medium");
  assert.equal(fallback.music, "auto");
  assert.equal(fallback.visualStyle, undefined);
});
