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

/**
 * Renders one scene: the still with a slow camera move, its narration, and (optionally) burned-in
 * captions from an .ass file. Every scene uses identical codec settings so they can be joined
 * without re-encoding.
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
  fontsDir?: string;
}): Promise<void> {
  const frames = Math.ceil(opts.seconds * FPS);
  const m = MOVES[opts.move % MOVES.length];
  const sub = (expr: string) => expr.replaceAll("N", String(frames));
  // Upscaling 2x before zoompan hides its whole-pixel stepping.
  const filters = [
    `scale=${opts.width * 2}:${opts.height * 2}:force_original_aspect_ratio=increase`,
    `crop=${opts.width * 2}:${opts.height * 2}`,
    `zoompan=z='${sub(m.z)}':x='${sub(m.x)}':y='${sub(m.y)}':d=${frames}:s=${opts.width}x${opts.height}:fps=${FPS}`,
    "format=yuv420p",
  ];
  if (opts.captions) {
    filters.push(`subtitles=${opts.captions}` + (opts.fontsDir ? `:fontsdir=${opts.fontsDir}` : ""));
  }
  await run(
    FFMPEG,
    [
      "-y",
      "-i", opts.image,
      "-i", opts.audio,
      "-filter_complex", `[0:v]${filters.join(",")}[v];[1:a]apad[a]`,
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

/** Joins scene files that share codec settings, without re-encoding. */
export async function concatScenes(cwd: string, listFile: string, out: string): Promise<void> {
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out], cwd);
}
