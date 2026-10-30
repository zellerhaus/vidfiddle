import { createHash } from "node:crypto";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { MOODS, type Mood, type MusicProvider } from "./types";

/**
 * Background music for local-engine videos. A library provider picks a track from folders of
 * audio files, filed by mood; the ElevenLabs provider composes a fresh instrumental per video
 * and falls back to the library if the request fails.
 */

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"]);

export interface Track {
  file: string;
  mood: Mood | null;
}

function asMood(value: string): Mood | null {
  const lower = value.toLowerCase();
  return (MOODS as readonly string[]).includes(lower) ? (lower as Mood) : null;
}

/** A track's mood comes from its folder ("calm/rain.mp3") or a file-name prefix ("calm-rain.mp3"). */
export function moodOf(file: string, root: string): Mood | null {
  const [first] = relative(root, file).split(sep);
  if (first !== basename(file)) return asMood(first);
  return asMood(basename(file).split(/[-_ .]/)[0] ?? "");
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

/** Lists audio files in each folder and its immediate subfolders. Missing folders are skipped. */
export async function listTracks(dirs: string[]): Promise<Track[]> {
  const tracks: Track[] = [];
  for (const root of dirs) {
    if (!(await exists(root))) continue;
    const walk = async (dir: string, depth: number) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && depth === 0) await walk(full, 1);
        else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          tracks.push({ file: full, mood: moodOf(full, root) });
        }
      }
    };
    await walk(root, 0);
  }
  return tracks.sort((a, b) => a.file.localeCompare(b.file));
}

/** Picks a track for the mood (any track if none match), varying with the seed so videos differ. */
export function pickTrack(tracks: Track[], mood: Mood, seed: string): Track | null {
  const matching = tracks.filter((t) => t.mood === mood);
  const pool = matching.length > 0 ? matching : tracks;
  if (pool.length === 0) return null;
  const n = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return pool[n % pool.length];
}

export function libraryMusic(dirs: string[], seed: string): MusicProvider {
  return {
    async track({ mood }) {
      return pickTrack(await listTracks(dirs), mood, seed)?.file ?? null;
    },
  };
}

const MOOD_PROMPTS: Record<Mood, string> = {
  upbeat: "Bright, upbeat instrumental with a light groove, claps and plucked synths",
  calm: "Calm, gentle instrumental with soft piano and warm pads",
  inspiring: "Inspiring, uplifting instrumental that builds with piano, strings and light drums",
  dramatic: "Cinematic, dramatic instrumental with tense strings and deep percussion",
  playful: "Playful, quirky instrumental with pizzicato strings, marimba and a bouncy bass",
};

/** Composes an instrumental per video with ElevenLabs Music; uses `fallback` if that fails. */
export function elevenLabsMusic(opts: { apiKey: string; model?: string; fallback?: MusicProvider }): MusicProvider {
  return {
    async track(req) {
      const out = join(req.workDir, "music.mp3");
      if (await exists(out)) return out;
      try {
        const res = await fetch("https://api.elevenlabs.io/v1/music", {
          method: "POST",
          headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `${MOOD_PROMPTS[req.mood]}. Background music under a narrated short video: steady energy, no vocals, no big drops.`,
            // A little longer than the video so the fade-out isn't cut short.
            music_length_ms: Math.min(300_000, Math.max(10_000, Math.ceil((req.seconds + 2) * 1000))),
            model_id: opts.model ?? "music_v2_5",
            force_instrumental: true,
          }),
        });
        if (!res.ok) throw new Error(`ElevenLabs music ${res.status}: ${(await res.text()).slice(0, 300)}`);
        await writeFile(out, Buffer.from(await res.arrayBuffer()));
        return out;
      } catch (error) {
        if (!opts.fallback) throw error;
        console.warn(`[music] ElevenLabs failed, using the library instead: ${error instanceof Error ? error.message : error}`);
        return opts.fallback.track(req);
      }
    },
  };
}

/**
 * Music provider from the environment: ElevenLabs when ELEVENLABS_API_KEY is set (unless
 * MUSIC_PROVIDER=library), otherwise the library. The library reads MUSIC_DIR (default
 * DATA_DIR/music) and then the bundled assets/music. `seed` varies the library pick per video.
 */
export function musicFromEnv(seed: string, env: NodeJS.ProcessEnv = process.env): MusicProvider {
  const library = libraryMusic(
    [env.MUSIC_DIR || join(env.DATA_DIR || "data", "music"), resolve("assets/music")],
    seed
  );
  if (env.ELEVENLABS_API_KEY && env.MUSIC_PROVIDER?.toLowerCase() !== "library") {
    return elevenLabsMusic({ apiKey: env.ELEVENLABS_API_KEY, model: env.ELEVENLABS_MUSIC_MODEL, fallback: library });
  }
  return library;
}
