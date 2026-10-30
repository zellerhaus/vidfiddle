import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildAss, DEFAULT_CAPTION_STYLE, type CaptionStyle } from "./captions";
import { concatScenes, finishAudio, probeDuration, renderScene } from "./ffmpeg";
import {
  MAX_SHOTS_PER_SCENE,
  OUTPUT_SIZE,
  SHOT_SECONDS,
  type AspectRatio,
  type CostLine,
  type CostSink,
  type EngineProviders,
  type Mood,
  type MusicProvider,
  type Pacing,
  type ScenePlan,
  type Word,
} from "./types";

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
  /** How often the picture changes. Defaults to "medium" (a new shot about every 4 seconds). */
  pacing?: Pacing;
  /** Background music. `mood` "auto" (the default) uses the planner's pick; omit `music` for none. */
  music?: { provider: MusicProvider; mood?: Mood | "auto"; volume?: number };
  /** Directory of fonts for captions. Defaults to the bundled assets/fonts (Anton, OFL). */
  fontsDir?: string;
  concurrency?: number;
  onProgress?: (message: string) => void;
}

export interface RenderResult {
  outFile: string;
  durationSeconds: number;
  scenes: number;
  /** The music file mixed in, if any. */
  musicTrack?: string;
  costUsd: number;
  costs: CostLine[];
}

const TAIL_SECONDS = 0.25; // breathing room after each scene's narration
const MIN_SHOT_SECONDS = 1.2; // shorter cuts read as flicker

/**
 * Splits a scene of `seconds` into `shots` shot lengths. Each cut lands on the word starting
 * nearest to an even split (within 0.6s), so the picture changes on a beat of the narration.
 */
/** Number of shots for a scene of `seconds` at the given pacing. */
export function shotsForScene(seconds: number, pacing: Pacing): number {
  const target = SHOT_SECONDS[pacing];
  if (!target) return 1;
  return Math.min(MAX_SHOTS_PER_SCENE, Math.max(1, Math.round(seconds / target)));
}

export function shotLengths(seconds: number, shots: number, words: Word[]): number[] {
  const cuts: number[] = [];
  for (let k = 1; k < shots; k++) {
    const target = (seconds * k) / shots;
    const nearest = words
      .map((w) => w.start)
      .filter((t) => Math.abs(t - target) <= 0.6)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    const cut = nearest ?? target;
    const previous = cuts.at(-1) ?? 0;
    if (cut - previous >= MIN_SHOT_SECONDS && seconds - cut >= MIN_SHOT_SECONDS) cuts.push(cut);
  }
  const edges = [0, ...cuts, seconds];
  return edges.slice(1).map((edge, i) => edge - edges[i]);
}

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

/** Whether an error is an image provider refusing the prompt (as opposed to a network or quota failure). */
export function isContentRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /safety system|content.policy|moderation|image_generation_user_error/i.test(message);
}

function genericScenePrompt(narration: string): string {
  return (
    "A symbolic still image evoking the idea of this narration, using objects, places and light rather " +
    `than people or characters: "${narration}". No faces, no costumes, no text, no logos.`
  );
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

/** Image prompt with the art style first: models weight the start, and a trailing style line lost to photographic scene detail. */
export function styledPrompt(style: string, visual: string): string {
  return `Art style: ${style}.\n\n${visual}\n\nRender the whole image in that art style.`;
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
      produce(file(i, "mp3"), (tmp) =>
        providers.voice.speak(scene.narration, tmp, {
          previous: plan.scenes[i - 1]?.narration,
          next: plan.scenes[i + 1]?.narration,
        })
      ),
      produce(file(i, "png"), async (tmp) => {
        try {
          await providers.visuals.still(styledPrompt(plan.style, scene.visual), aspect, tmp);
        } catch (error) {
          if (!isContentRejection(error)) throw error;
          // One refused image shouldn't sink the whole video: fall back to a symbolic scene.
          log(`Scene ${i + 1}: image prompt refused by the safety filter, retrying with a generic prompt`);
          await providers.visuals.still(styledPrompt(plan.style, genericScenePrompt(scene.narration)), aspect, tmp);
        }
      }),
    ]);
    log(`Scene ${i + 1}: voice and image ready`);
  });

  // 3. Word timings, for captions and for cutting shots on word boundaries.
  const captions = opts.captions ?? true;
  const pacing = opts.pacing ?? "medium";
  const needWords = captions || SHOT_SECONDS[pacing] !== null;
  if (needWords) {
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
    const words: Word[] = needWords ? JSON.parse(await readFile(file(i, "words.json"), "utf8")) : [];
    const shots = shotLengths(seconds, shotsForScene(seconds, pacing), words);
    // Different shot cuts (a changed pacing) mean the rendered scene is stale.
    const shotsFile = file(i, "shots.json");
    const shotsText = JSON.stringify(shots);
    if ((await exists(shotsFile)) && (await readFile(shotsFile, "utf8")) !== shotsText) {
      await rm(file(i, "mp4"), { force: true });
    }
    await writeFile(shotsFile, shotsText);
    let ass: string | null = null;
    if (captions) {
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
        shots,
        fontsDir: opts.fontsDir ?? resolve("assets/fonts"),
      })
    );
    log(`Scene ${i + 1}: rendered`);
  });

  const list = plan.scenes.map((_, i) => `file '${file(i, "mp4")}'`).join("\n");
  await writeFile(join(work, "scenes.txt"), list + "\n");
  const out = resolve(opts.outFile);
  const joined = join(work, "joined.mp4");
  await concatScenes(work, join(work, "scenes.txt"), joined);
  const seconds = await probeDuration(joined);

  // 5. Final audio: leveled narration, with a music bed under it when one is available.
  const volume = opts.music?.volume ?? 0.3;
  let musicTrack: string | undefined;
  if (opts.music && volume > 0) {
    const mood = !opts.music.mood || opts.music.mood === "auto" ? plan.mood ?? "inspiring" : opts.music.mood;
    const track = await opts.music.provider.track({ mood, style: plan.style, seconds, workDir: work });
    if (track) {
      log(`Music: ${mood} (${track.split("/").pop()})`);
      musicTrack = track;
    } else {
      log("Music: no track available, rendering without music");
    }
  }
  await finishAudio({ cwd: work, video: joined, out, seconds, music: musicTrack ? { file: musicTrack, volume } : undefined });

  const durationSeconds = await probeDuration(out);
  const costUsd = costs.reduce((sum, c) => sum + c.usd, 0);
  const result = { outFile: out, durationSeconds, scenes: plan.scenes.length, musicTrack, costUsd, costs };
  await writeFile(join(work, "result.json"), JSON.stringify(result, null, 2));
  return result;
}
