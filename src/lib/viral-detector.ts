/**
 * Claude-powered viral moment detection
 * Analyzes transcripts to identify the best short-form clip moments
 */

import type { WordTimestamp, ViralMoment } from "@/lib/supabase/types";
import { complete } from "@/lib/llm";

export interface ViralDetectionParams {
  title: string;
  transcript: WordTimestamp[];
  targetClipDuration?: number; // seconds, default 45
  maxClips?: number; // default 5
}

/**
 * Detect viral moments in a transcript using Claude.
 * Returns ranked moments with timestamps and reasoning.
 */
export async function detectViralMoments(
  params: ViralDetectionParams
): Promise<ViralMoment[]> {
  const {
    title,
    transcript,
    targetClipDuration = 45,
    maxClips = 5,
  } = params;

  // Build a timestamped transcript string for Claude
  const transcriptText = buildTimestampedTranscript(transcript);
  const totalDuration = transcript.length > 0
    ? transcript[transcript.length - 1].end
    : 0;

  const systemPrompt = `You are an expert short-form video editor who identifies the most viral, engaging moments from long-form content. You have deep expertise in what makes clips go viral on TikTok, Instagram Reels, and YouTube Shorts.

Your task is to analyze a timestamped transcript and identify the ${maxClips} best moments to extract as ${targetClipDuration}-second clips.

Look for moments that have:
- **Strong hooks**: Surprising statements, bold claims, counterintuitive insights
- **Emotional peaks**: Passion, humor, vulnerability, anger, excitement
- **Standalone value**: The clip makes sense without additional context
- **Curiosity gaps**: Statements that make viewers want to learn more
- **Actionable advice**: Specific, practical tips people can immediately use
- **Controversy/debate**: Polarizing opinions that drive comments
- **Storytelling**: Mini-narratives with setup, tension, and payoff

Each clip should be approximately ${targetClipDuration} seconds (±10 seconds). Clips must NOT overlap.

IMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no explanations.`;

  const userPrompt = `Video title: "${title}"
Total duration: ${Math.round(totalDuration)} seconds

Timestamped transcript:
${transcriptText}

Identify the top ${maxClips} most viral moments. For each moment, provide the exact start and end timestamps (in seconds) that would make the best clip.

Return a JSON array with this exact structure:
[
  {
    "startTime": 45.2,
    "endTime": 92.8,
    "title": "Short catchy title for this clip",
    "hookReason": "Why this moment is viral-worthy (1-2 sentences)",
    "viralScore": 0.92
  }
]

Sort by viralScore descending (best clip first). viralScore should be 0-1 where 1 is extremely viral.`;

  console.log(
    `[ViralDetector] Analyzing ${Math.round(totalDuration)}s transcript for viral moments`
  );

  const responseText = await complete({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 2048,
  });

  // Parse the JSON response
  let moments: Array<{
    startTime: number;
    endTime: number;
    title: string;
    hookReason: string;
    viralScore: number;
  }>;

  try {
    // Handle potential markdown code fences
    const cleaned = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    moments = JSON.parse(cleaned);
  } catch {
    console.error("[ViralDetector] Failed to parse response:", responseText);
    throw new Error("Failed to parse viral moments from Claude response");
  }

  if (!Array.isArray(moments) || moments.length === 0) {
    throw new Error("No viral moments detected");
  }

  // Enrich each moment with the word-level timestamps for its time range
  const enrichedMoments: ViralMoment[] = moments.map((moment) => {
    const words = transcript.filter(
      (w) => w.start >= moment.startTime && w.end <= moment.endTime
    );

    return {
      startTime: moment.startTime,
      endTime: moment.endTime,
      title: moment.title,
      hookReason: moment.hookReason,
      viralScore: moment.viralScore,
      words,
    };
  });

  console.log(
    `[ViralDetector] Detected ${enrichedMoments.length} viral moments`
  );

  return enrichedMoments;
}

/**
 * Build a readable timestamped transcript for Claude to analyze.
 * Groups words into sentence-like chunks with timestamps.
 */
function buildTimestampedTranscript(words: WordTimestamp[]): string {
  const lines: string[] = [];
  let currentLine: string[] = [];
  let lineStart = 0;

  for (const word of words) {
    if (currentLine.length === 0) {
      lineStart = word.start;
    }

    currentLine.push(word.word);

    // Break lines at sentence boundaries or every ~15 words
    const endsWithPunctuation = /[.!?]$/.test(word.word);
    if (endsWithPunctuation || currentLine.length >= 15) {
      const timestamp = formatTimestamp(lineStart);
      lines.push(`[${timestamp}] ${currentLine.join(" ")}`);
      currentLine = [];
    }
  }

  // Flush remaining words
  if (currentLine.length > 0) {
    const timestamp = formatTimestamp(lineStart);
    lines.push(`[${timestamp}] ${currentLine.join(" ")}`);
  }

  return lines.join("\n");
}

/**
 * Format seconds as MM:SS
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
