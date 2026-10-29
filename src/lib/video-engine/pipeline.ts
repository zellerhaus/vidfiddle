import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildAss, DEFAULT_CAPTION_STYLE, type CaptionStyle } from "./captions";
import { concatScenes, probeDuration, renderScene } from "./ffmpeg";
import { OUTPUT_SIZE, type AspectRatio, type CostLine, type CostSink, type EngineProviders, type ScenePlan, type Word } from "./types";

export interface RenderOptions {
  script: string;
  /** Holds intermediate files. Re-running with the same workDir reuses finished stages. */
  workDir: string;
  outFile: string;
  /** Builds the stage providers, given the sink that records this job's costs. */
  providers: (costs: CostSink) => EngineProviders;
  aspect?: AspectRatio;
  /** Art direction for every image. Omit to let the planner choose one. */
  style?: string;
  captions?: boolean;
  captionStyle?: CaptionStyle;
  /** Directory of fonts for captions. Defaults to the bundled assets/fonts (Anton, OFL). */
  fontsDir?: string;
  concurrency?: number;
  onProgress?: (message: string) => void;
}

export interface RenderResult {
  outFile: string;
  durationSeconds: number;
  scenes: number;
  costUsd: number;
  costs: CostLine[];
}

const TAIL_SECONDS = 0.25; // breathing room after each scene's narration

/** Removes stage directions like "[HOOK]" or "(pause)" that shouldn't be read aloud. */
export function cleanScript(script: string): string {
  return script
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Splits narration into scenes of whole sentences, about 6–9 seconds of speech each. Splitting
 * here rather than in the model guarantees every word of the script is spoken, in order.
 */
export function splitIntoScenes(script: string, targetWords = 20): string[] {
  const sentences = script.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const scenes: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    if (count > 0 && count + words > targetWords * 1.3) {
      scenes.push(current.join(" "));
      current = [];
      count = 0;
    }
    current.push(sentence);
    count += words;
    if (count >= targetWords) {
      scenes.push(current.join(" "));
      current = [];
      count = 0;
    }
  }
  if (current.length) scenes.push(current.join(" "));
  return scenes;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Writes via a temp file so an interrupted call never leaves a half-written file to be reused. */
async function produce(file: string, make: (tmp: string) => Promise<void>): Promise<void> {
  if (await exists(file)) return;
  const tmp = file.replace(/(\.\w+)$/, ".partial$1");
  await make(tmp);
  await rename(tmp, file);
}

export async function renderVideo(opts: RenderOptions): Promise<RenderResult> {
  const aspect = opts.aspect ?? "9x16";
  const size = OUTPUT_SIZE[aspect];
  const work = resolve(opts.workDir);
  const log = opts.onProgress ?? (() => {});
  await mkdir(work, { recursive: true });

  // Costs from earlier, interrupted runs of the same job still count toward its total.
  const costFile = join(work, "costs.jsonl");
  const costs: CostLine[] = (await exists(costFile))
    ? (await readFile(costFile, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const providers = opts.providers({
    add(line: CostLine) {
      costs.push(line);
      void appendFile(costFile, JSON.stringify(line) + "\n");
    },
  });

  // 1. Plan scenes, reusing the saved plan if the script and settings are unchanged.
  const script = cleanScript(opts.script);
  const planKey = createHash("sha256").update(JSON.stringify([script, aspect, opts.style ?? ""])).digest("hex");
  const planFile = join(work, "plan.json");
  let plan: ScenePlan;
  const saved = (await exists(planFile)) ? JSON.parse(await readFile(planFile, "utf8")) : null;
  if (saved?.key === planKey) {
    plan = saved.plan;
  } else {
    // A new script, aspect or style invalidates every scene file from the previous plan.
    for (const name of await readdir(work)) {
      if (name.startsWith("scene-")) await rm(join(work, name));
    }
    log("Planning scenes");
    plan = await providers.planner.plan(splitIntoScenes(script), { aspect, style: opts.style });
    await writeFile(planFile, JSON.stringify({ key: planKey, plan }, null, 2));
  }
  log(`${plan.scenes.length} scenes. Style: ${plan.style}`);

  // 2. Voice and image for each scene, in parallel. Finished files are kept between runs.
  const file = (i: number, ext: string) => join(work, `scene-${String(i + 1).padStart(2, "0")}.${ext}`);
  await pool(plan.scenes, opts.concurrency ?? 4, async (scene, i) => {
    await Promise.all([
      produce(file(i, "mp3"), (tmp) => providers.voice.speak(scene.narration, tmp)),
      produce(file(i, "png"), (tmp) =>
        providers.visuals.still(`${scene.visual}\n\nStyle: ${plan.style}`, aspect, tmp)
      ),
    ]);
    log(`Scene ${i + 1}: voice and image ready`);
  });

  // 3. Word timings for captions.
  const captions = opts.captions ?? true;
  if (captions) {
    await pool(plan.scenes, opts.concurrency ?? 4, async (_, i) => {
      await produce(file(i, "words.json"), async (tmp) => {
        const words: Word[] = await providers.transcriber.words(file(i, "mp3"));
        await writeFile(tmp, JSON.stringify(words));
      });
    });
  }

  // 4. Render each scene, then join them.
  await pool(plan.scenes, 2, async (_, i) => {
    const seconds = (await probeDuration(file(i, "mp3"))) + TAIL_SECONDS;
    let ass: string | null = null;
    if (captions) {
      const words: Word[] = JSON.parse(await readFile(file(i, "words.json"), "utf8"));
      ass = `scene-${String(i + 1).padStart(2, "0")}.ass`;
      const text = buildAss(words, size, opts.captionStyle ?? DEFAULT_CAPTION_STYLE);
      // Changed caption styling means the rendered scene is stale.
      if ((await exists(join(work, ass))) && (await readFile(join(work, ass), "utf8")) !== text) {
        await rm(file(i, "mp4"), { force: true });
      }
      await writeFile(join(work, ass), text);
    }
    await produce(file(i, "mp4"), (tmp) =>
      renderScene({
        cwd: work,
        image: file(i, "png"),
        audio: file(i, "mp3"),
        captions: ass,
        out: tmp,
        seconds,
        ...size,
        move: i,
        fontsDir: opts.fontsDir ?? resolve("assets/fonts"),
      })
    );
    log(`Scene ${i + 1}: rendered`);
  });

  const list = plan.scenes.map((_, i) => `file '${file(i, "mp4")}'`).join("\n");
  await writeFile(join(work, "scenes.txt"), list + "\n");
  const out = resolve(opts.outFile);
  await concatScenes(work, join(work, "scenes.txt"), out);

  const durationSeconds = await probeDuration(out);
  const costUsd = costs.reduce((sum, c) => sum + c.usd, 0);
  await writeFile(
    join(work, "result.json"),
    JSON.stringify({ outFile: out, durationSeconds, scenes: plan.scenes.length, costUsd, costs }, null, 2)
  );
  return { outFile: out, durationSeconds, scenes: plan.scenes.length, costUsd, costs };
}
