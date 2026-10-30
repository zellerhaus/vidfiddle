import { spawn } from "node:child_process";

// Captions need an ffmpeg built with libass (the `subtitles` filter). Debian's ffmpeg package
// has it; on macOS use `brew install ffmpeg-full` and point FFMPEG_PATH at it.
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-1500)}`))
    );
  });
}

export async function probeDuration(file: string): Promise<number> {
  const out = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`Could not read duration of ${file}`);
  return seconds;
}

export const FPS = 30;

// Slow camera moves, cycled across scenes so consecutive stills don't feel identical.
// `on` is the output frame number and `N` the scene's frame count.
const MOVES = [
  { z: "1+0.12*on/N", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }, // push in
  { z: "1.12-0.12*on/N", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }, // pull out
  { z: "1.1", x: "(iw-iw/zoom)*on/N", y: "ih/2-(ih/zoom/2)" }, // pan right
  { z: "1.1", x: "(iw-iw/zoom)*(1-on/N)", y: "ih/2-(ih/zoom/2)" }, // pan left
];

// Tighter framings for a scene's later shots: punch in on part of the image and drift slowly.
const SHOT_MOVES = [
  { z: "1.32+0.05*on/N", x: "(iw-iw/zoom)*0.5", y: "(ih-ih/zoom)*0.42" }, // punch in, just above center
  { z: "1.55-0.06*on/N", x: "(iw-iw/zoom)*0.3", y: "(ih-ih/zoom)*0.45" }, // tight on the left, easing out
  { z: "1.55-0.06*on/N", x: "(iw-iw/zoom)*0.7", y: "(ih-ih/zoom)*0.45" }, // tight on the right, easing out
];

/**
 * Renders one scene: the still with a slow camera move, its narration, and (optionally) burned-in
 * captions from an .ass file. With several `shots` (durations in seconds), the still is cut into
 * that many framings: the scene's camera move first, then tighter punch-ins. Every scene uses
 * identical codec settings so they can be joined without re-encoding.
 */
export async function renderScene(opts: {
  cwd: string;
  image: string;
  audio: string;
  captions: string | null;
  out: string;
  seconds: number;
  width: number;
  height: number;
  move: number;
  /** Shot lengths in seconds, summing to `seconds`. Defaults to a single shot. */
  shots?: number[];
  fontsDir?: string;
}): Promise<void> {
  const frames = Math.ceil(opts.seconds * FPS);
  const shots = opts.shots && opts.shots.length > 1 ? opts.shots : [opts.seconds];
  // Frame counts per shot, with the last absorbing rounding so the scene keeps its exact length.
  const shotFrames = shots.map((d) => Math.max(1, Math.round(d * FPS)));
  shotFrames[shotFrames.length - 1] = Math.max(1, frames - shotFrames.slice(0, -1).reduce((a, b) => a + b, 0));
  const zoompan = (m: { z: string; x: string; y: string }, n: number) => {
    const sub = (expr: string) => expr.replaceAll("N", String(n));
    return `zoompan=z='${sub(m.z)}':x='${sub(m.x)}':y='${sub(m.y)}':d=${n}:s=${opts.width}x${opts.height}:fps=${FPS}`;
  };
  // Upscaling 2x before zoompan hides its whole-pixel stepping.
  const base = [
    `scale=${opts.width * 2}:${opts.height * 2}:force_original_aspect_ratio=increase`,
    `crop=${opts.width * 2}:${opts.height * 2}`,
  ].join(",");
  const finish = ["format=yuv420p"];
  if (opts.captions) {
    finish.push(`subtitles=${opts.captions}` + (opts.fontsDir ? `:fontsdir=${opts.fontsDir}` : ""));
  }
  let video: string;
  if (shots.length === 1) {
    video = `[0:v]${base},${zoompan(MOVES[opts.move % MOVES.length], frames)},${finish.join(",")}[v]`;
  } else {
    const labels = shots.map((_, k) => `[s${k}]`).join("");
    const parts = shots.map((_, k) => {
      const m = k === 0 ? MOVES[opts.move % MOVES.length] : SHOT_MOVES[(opts.move + k - 1) % SHOT_MOVES.length];
      return `[s${k}]${zoompan(m, shotFrames[k])},setsar=1[v${k}]`;
    });
    const joined = shots.map((_, k) => `[v${k}]`).join("");
    video = [`[0:v]${base},split=${shots.length}${labels}`, ...parts, `${joined}concat=n=${shots.length}:v=1:a=0,${finish.join(",")}[v]`].join(";");
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i", opts.image,
      "-i", opts.audio,
      "-filter_complex", `${video};[1:a]apad[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-t", opts.seconds.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      opts.out,
    ],
    opts.cwd
  );
}

/**
 * Final audio pass on the joined video. The narration is leveled to social-media loudness
 * (TTS arrives around -30 LUFS; platforms expect about -14). With `music`, a bed is looped or
 * trimmed to length, leveled about 15 dB under the voice at the default volume (0.3 on the app's
 * 0–1 slider), faded, and ducked further by a sidechain compressor whenever the voice speaks.
 */
export async function finishAudio(opts: {
  cwd: string;
  video: string;
  out: string;
  seconds: number;
  music?: { file: string; volume: number };
}): Promise<void> {
  const s = opts.seconds.toFixed(3);
  let graph: string;
  if (opts.music) {
    const fadeOut = Math.min(2, opts.seconds / 4);
    const gain = ((Math.min(1, Math.max(0, opts.music.volume)) / 0.3) * 0.9).toFixed(3);
    graph = [
      `[0:a]loudnorm=I=-15:TP=-2:LRA=11,asplit=2[voice][key]`,
      `[1:a]atrim=0:${s},asetpts=PTS-STARTPTS,loudnorm=I=-24:TP=-2:LRA=11,volume=${gain},` +
        `afade=t=in:d=0.6,afade=t=out:st=${(opts.seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(2)}[bed]`,
      `[bed][key]sidechaincompress=threshold=0.03:ratio=4:attack=15:release=350[ducked]`,
      `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.89[a]`,
    ].join(";");
  } else {
    graph = `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i", opts.video,
      ...(opts.music ? ["-stream_loop", "-1", "-i", opts.music.file] : []),
      "-filter_complex", graph,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", s,
      "-movflags", "+faststart",
      opts.out,
    ],
    opts.cwd
  );
}

/** Joins scene files that share codec settings, without re-encoding. */
export async function concatScenes(cwd: string, listFile: string, out: string): Promise<void> {
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out], cwd);
}
