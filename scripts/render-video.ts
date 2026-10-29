/**
 * Render a narration script to MP4 with the local engine, using only an OpenAI key.
 *
 *   npx tsx scripts/render-video.ts --script post.txt --out video.mp4 [--aspect 9x16]
 *     [--voice coral] [--style "flat paper-cut illustration"] [--work .renders/post] [--no-captions]
 *
 * Needs OPENAI_API_KEY and an ffmpeg with libass (FFMPEG_PATH / FFPROBE_PATH to override).
 * Re-running with the same --work directory reuses finished scenes, so tweaking the render
 * doesn't pay for voice or images again.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { renderVideo } from "../src/lib/video-engine/pipeline";
import { openAIProviders } from "../src/lib/video-engine/providers/openai";
import type { AspectRatio } from "../src/lib/video-engine/types";

const { values } = parseArgs({
  options: {
    script: { type: "string" },
    out: { type: "string" },
    aspect: { type: "string", default: "9x16" },
    voice: { type: "string" },
    style: { type: "string" },
    work: { type: "string" },
    "no-captions": { type: "boolean", default: false },
  },
});

if (!values.script) {
  console.error("Usage: render-video --script <file> [--out video.mp4] [--aspect 9x16|16x9|1x1]");
  process.exit(1);
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Set OPENAI_API_KEY.");
  process.exit(1);
}
if (!["9x16", "16x9", "1x1"].includes(values.aspect!)) {
  console.error("--aspect must be 9x16, 16x9 or 1x1");
  process.exit(1);
}

async function main(scriptPath: string, openAIKey: string) {
  const name = basename(scriptPath, extname(scriptPath));
  const started = Date.now();
  const result = await renderVideo({
    script: await readFile(scriptPath, "utf8"),
    workDir: values.work ?? `.renders/${name}`,
    outFile: values.out ?? `${name}.mp4`,
    aspect: values.aspect as AspectRatio,
    style: values.style,
    captions: !values["no-captions"],
    providers: openAIProviders({
      apiKey: openAIKey,
      voice: values.voice,
      textModel: process.env.OPENAI_TEXT_MODEL,
      imageModel: process.env.OPENAI_IMAGE_MODEL,
    }),
    onProgress: (m) => console.log(`  ${m}`),
  });

  const byStage = new Map<string, number>();
  for (const c of result.costs) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + c.usd);
  console.log(
    `\n${result.outFile}: ${result.durationSeconds.toFixed(1)}s, ${result.scenes} scenes, ` +
      `rendered in ${Math.round((Date.now() - started) / 1000)}s`
  );
  console.log(
    `Cost $${result.costUsd.toFixed(3)} (` +
      [...byStage].map(([stage, usd]) => `${stage} $${usd.toFixed(3)}`).join(", ") +
      "; voice and transcription estimated from duration)"
  );
}

main(values.script, apiKey).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
