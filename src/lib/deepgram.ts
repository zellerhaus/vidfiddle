/**
 * Deepgram transcription client
 * Uses Nova-2 model for word-level timestamps
 */

import type { WordTimestamp } from "@/lib/supabase/types";

const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResult {
  channels: DeepgramChannel[];
}

interface DeepgramResponse {
  results: DeepgramResult;
  metadata: {
    duration: number;
    channels: number;
  };
}

/**
 * Transcribe audio from a URL using Deepgram Nova-2.
 * Returns word-level timestamps for caption sync.
 */
export async function transcribeAudio(audioUrl: string): Promise<{
  words: WordTimestamp[];
  fullTranscript: string;
  durationSeconds: number;
}> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY environment variable is not set");
  }

  console.log("[Deepgram] Starting transcription for:", audioUrl);

  const response = await fetch(
    `${DEEPGRAM_API_URL}?model=nova-2&smart_format=true&punctuate=true&utterances=true&diarize=false`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Deepgram API error (${response.status}): ${errorText}`
    );
  }

  const data: DeepgramResponse = await response.json();

  const channel = data.results.channels[0];
  if (!channel || !channel.alternatives[0]) {
    throw new Error("No transcription results returned from Deepgram");
  }

  const alternative = channel.alternatives[0];

  const words: WordTimestamp[] = alternative.words.map((w) => ({
    word: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));

  console.log(
    `[Deepgram] Transcription complete: ${words.length} words, ${data.metadata.duration}s`
  );

  return {
    words,
    fullTranscript: alternative.transcript,
    durationSeconds: data.metadata.duration,
  };
}

/**
 * Check if Deepgram is configured
 */
export function isDeepgramConfigured(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}
