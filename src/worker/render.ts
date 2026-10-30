/**
 * Renders videos created with the local engine (see src/lib/local-engine.ts for the contract).
 * Claims one pending row at a time, renders it, stores the MP4, writes platform captions, and
 * hands the video to the review queue, the same end state as a finished Creatify job.
 */
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { generateMultipleCaptions, isClaudeConfigured } from "@/lib/claude";
import { isLocalEngineOptions, toAspectRatio, toMusicChoice, toPacing } from "@/lib/local-engine";
import { publicUrl, saveFile } from "@/lib/storage";
import type { Platform } from "@/lib/supabase/types";
import { musicFromEnv } from "@/lib/video-engine/music";
import { renderVideo } from "@/lib/video-engine/pipeline";
import { openAIProviders } from "@/lib/video-engine/providers/openai";

// Same platforms check-creatify writes captions for.
const CAPTION_PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "linkedin", "twitter", "facebook"];
const POLL_MS = 15_000;

const isLocal = sql`${videos.style_options}->>'apiVersion' = 'local'`;

/** Rows left "generating" by a worker that stopped mid-render go back to the queue. */
export async function requeueInterruptedRenders(): Promise<number> {
  const rows = await db
    .update(videos)
    .set({ status: "pending" })
    .where(sql`${videos.status} = 'generating' and ${isLocal}`)
    .returning({ id: videos.id });
  return rows.length;
}

async function claimNext(): Promise<{ id: string; script: string; style_options: unknown } | null> {
  // SKIP LOCKED lets several workers share the queue without rendering the same video twice.
  const rows = await db.execute<{ id: string; script: string; style_options: unknown }>(sql`
    update videos set status = 'generating'
    where id = (
      select id from videos
      where status = 'pending' and style_options->>'apiVersion' = 'local'
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, script, style_options
  `);
  return rows[0] ?? null;
}

async function renderOne(job: { id: string; script: string; style_options: unknown }): Promise<void> {
  const options = isLocalEngineOptions(job.style_options) ? job.style_options : null;
  const workDir = resolve(process.env.DATA_DIR ?? "data", "renders", job.id);
  const outFile = join(workDir, "final.mp4");
  const started = Date.now();
  const music = toMusicChoice(options?.music);
  console.log(`[render] ${job.id}: started`);

  const result = await renderVideo({
    script: job.script,
    workDir,
    outFile,
    aspect: toAspectRatio(options?.aspectRatio),
    style: options?.visualStyle || undefined,
    pacing: toPacing(options?.pacing),
    music:
      music === "none"
        ? undefined
        : { provider: musicFromEnv(job.id), mood: music, volume: options?.musicVolume ?? 0.3 },
    providers: openAIProviders({
      apiKey: process.env.OPENAI_API_KEY!,
      voice: options?.voice,
      textModel: process.env.OPENAI_TEXT_MODEL,
      imageModel: process.env.OPENAI_IMAGE_MODEL,
    }),
    onProgress: (message) => console.log(`[render] ${job.id}: ${message}`),
  });

  const key = `generated/${job.id}.mp4`;
  await saveFile(key, createReadStream(outFile), "video/mp4");

  let captions: Record<string, string> | null = null;
  if (isClaudeConfigured()) {
    try {
      const generated = await generateMultipleCaptions(job.script, CAPTION_PLATFORMS);
      captions = Object.fromEntries(Object.entries(generated).map(([platform, c]) => [platform, c.caption]));
    } catch (error) {
      // Captions can be generated later from the review screen.
      console.error(`[render] ${job.id}: caption generation failed`, error);
    }
  }

  await db
    .update(videos)
    .set({
      status: "completed",
      video_url: publicUrl(key),
      duration_seconds: Math.round(result.durationSeconds),
      approval_status: "pending_review",
      error_message: null,
      ...(captions ? { generated_captions: captions } : {}),
    })
    .where(eq(videos.id, job.id));

  // Intermediate files are only kept to resume a failed render.
  await rm(workDir, { recursive: true, force: true });
  console.log(
    `[render] ${job.id}: done in ${Math.round((Date.now() - started) / 1000)}s, ` +
      `${result.durationSeconds.toFixed(1)}s video, $${result.costUsd.toFixed(3)}`
  );
}

/** Polls for local videos and renders them one at a time. Returns a function that stops polling. */
export function startRenderLoop(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async () => {
    while (!stopped) {
      let job: Awaited<ReturnType<typeof claimNext>> = null;
      try {
        job = await claimNext();
        if (!job) break;
        await renderOne(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[render] ${job?.id ?? "claim"}: ${message}`);
        if (job) {
          await db
            .update(videos)
            .set({ status: "failed", error_message: message.slice(0, 1000) })
            .where(eq(videos.id, job.id))
            .catch(() => {});
        }
      }
    }
    if (!stopped) timer = setTimeout(loop, POLL_MS);
  };

  void loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
