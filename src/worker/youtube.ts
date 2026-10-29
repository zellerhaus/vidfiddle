/**
 * YouTube download and clip cutting, ported from the old Railway worker. Both jobs run in the
 * background and report back through the database: check-youtube watches
 * youtube_sources.source_video_url and youtube_clips.raw_clip_url to advance the pipeline.
 *
 * Storage keys match what check-youtube expects: it derives the audio URL by replacing
 * "source.mp4" with "audio.mp3".
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { youtube_clips, youtube_sources } from "@/db/schema";
import { downloadVideo, keyFromUrl, localPath, publicUrl, saveFile } from "@/lib/storage";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function downloadSource(youtubeUrl: string, sourceId: string): Promise<void> {
  try {
    const result = await withTempDir("yt", async (dir) => {
      const { stdout } = await run(YT_DLP, ["--dump-json", "--no-download", youtubeUrl], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const info = JSON.parse(stdout);

      // 720p max keeps files manageable; audio is a small MP3 for transcription.
      const videoPath = join(dir, "video.mp4");
      await run(YT_DLP, [
        "-f",
        "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        videoPath,
        youtubeUrl,
      ]);
      const audioPath = join(dir, "audio.mp3");
      await run(YT_DLP, ["-x", "--audio-format", "mp3", "--audio-quality", "128K", "-o", audioPath, youtubeUrl]);

      const videoKey = `youtube/${info.id}/source.mp4`;
      await saveFile(videoKey, createReadStream(videoPath), "video/mp4");
      await saveFile(`youtube/${info.id}/audio.mp3`, createReadStream(audioPath), "audio/mpeg");
      return {
        title: (info.title as string) || "Untitled",
        channelName: (info.channel as string) || (info.uploader as string) || "Unknown",
        durationSeconds: Math.round(info.duration || 0),
        videoUrl: publicUrl(videoKey),
      };
    });

    await db
      .update(youtube_sources)
      .set({
        title: result.title,
        channel_name: result.channelName,
        duration_seconds: result.durationSeconds,
        source_video_url: result.videoUrl,
      })
      .where(eq(youtube_sources.id, sourceId));
    console.log(`[youtube] source ${sourceId} downloaded: ${result.title}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed";
    console.error(`[youtube] source ${sourceId} failed: ${message}`);
    await db
      .update(youtube_sources)
      .set({ status: "failed", error_message: message.slice(0, 1000) })
      .where(eq(youtube_sources.id, sourceId));
  }
}

export async function cutClip(params: {
  videoUrl: string;
  startTime: number;
  endTime: number;
  clipId: string;
}): Promise<void> {
  const { videoUrl, startTime, endTime, clipId } = params;
  try {
    const clipUrl = await withTempDir("clip", async (dir) => {
      // Read the source straight from disk when it's in local storage; otherwise download it.
      const key = keyFromUrl(videoUrl);
      let input = key ? localPath(key) : null;
      if (!input) {
        input = join(dir, "input.mp4");
        await writeFile(input, await downloadVideo(videoUrl));
      }

      // -ss before -i seeks fast; stream copy cuts without re-encoding.
      const output = join(dir, "clip.mp4");
      await run(FFMPEG, [
        "-ss", String(startTime),
        "-i", input,
        "-t", String(endTime - startTime),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-y", output,
      ]);
      const clipKey = `youtube/clips/${clipId}.mp4`;
      await saveFile(clipKey, createReadStream(output), "video/mp4");
      return publicUrl(clipKey);
    });

    await db.update(youtube_clips).set({ raw_clip_url: clipUrl }).where(eq(youtube_clips.id, clipId));
    console.log(`[youtube] clip ${clipId} cut`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cut failed";
    console.error(`[youtube] clip ${clipId} failed: ${message}`);
    await db
      .update(youtube_clips)
      .set({ status: "failed", error_message: message.slice(0, 1000) })
      .where(eq(youtube_clips.id, clipId));
  }
}
