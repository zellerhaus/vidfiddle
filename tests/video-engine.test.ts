import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAss, groupWords } from "../src/lib/video-engine/captions";
import { cleanScript, isContentRejection, splitIntoScenes } from "../src/lib/video-engine/pipeline";

const words = (spec: [string, number, number][]) => spec.map(([word, start, end]) => ({ word, start, end }));

test("cleanScript drops stage directions", () => {
  assert.equal(cleanScript("[HOOK] Stop scrolling. (pause)\n\nHere's why."), "Stop scrolling.\nHere's why.");
});

test("splitIntoScenes keeps every word, in order", () => {
  const script =
    "Most houseplants don't die from neglect. They die from too much love. Overwatering is the number one " +
    "killer. Roots need air as much as water, and soggy soil suffocates them. Here's the fix! Push your finger " +
    "into the soil. If it's damp, walk away?\nThen empty the saucer";
  const scenes = splitIntoScenes(script, 20);
  assert.ok(scenes.length >= 2);
  assert.equal(scenes.join(" ").replace(/\s+/g, " "), script.replace(/\s+/g, " "));
});

test("splitIntoScenes never splits inside a sentence", () => {
  const long = "word ".repeat(40).trim() + ".";
  assert.deepEqual(splitIntoScenes(`${long} Short one.`, 20), [long, "Short one."]);
});

test("groupWords breaks on pauses and line length", () => {
  const lines = groupWords(
    words([
      ["one", 0, 0.2],
      ["two", 0.25, 0.4],
      ["three", 0.45, 0.6],
      ["four", 0.65, 0.8],
      ["after", 1.5, 1.7],
    ]),
    3
  );
  assert.deepEqual(
    lines.map((l) => l.map((w) => w.word)),
    [["one", "two", "three"], ["four"], ["after"]]
  );
});

test("buildAss highlights each word once and escapes override braces", () => {
  const ass = buildAss(
    words([
      ["{bad}", 0, 0.3],
      ["word", 0.35, 0.6],
    ]),
    { width: 1080, height: 1920 }
  );
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(events.length, 2);
  assert.match(events[0], /0:00:00\.00,0:00:00\.35/);
  assert.ok(!ass.includes("{bad}"));
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
});

test("buildAss never shows two caption lines at once", () => {
  // The last word of a line ends after the next line starts, as whisper timings sometimes do.
  const ass = buildAss(
    words([
      ["seven", 0, 0.3],
      ["thousand", 0.3, 0.6],
      ["five", 0.6, 0.9],
      ["light", 0.95, 1.2],
    ]),
    { width: 1080, height: 1920 }
  );
  const seconds = (t: string) => t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  const spans = ass
    .split("\n")
    .filter((l) => l.startsWith("Dialogue:"))
    .map((l) => l.split(",").slice(1, 3).map(seconds));
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `event ${i} overlaps the previous one`);
});

test("isContentRejection recognizes safety refusals but not other failures", () => {
  assert.ok(isContentRejection(new Error('OpenAI images/generations failed: 400 {"error": {"message": "Your request was rejected by the safety system."')));
  assert.ok(isContentRejection(new Error('400 {"type": "image_generation_user_error"}')));
  assert.ok(!isContentRejection(new Error("OpenAI images/generations failed: 429 rate limit")));
  assert.ok(!isContentRejection(new Error("fetch failed")));
});
