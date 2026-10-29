/**
 * Submagic Magic Clips API client
 *
 * Creates short-form video clips from YouTube videos with
 * AI-powered clip selection, face tracking, and captions.
 */

const SUBMAGIC_API_BASE = "https://api.submagic.co/v1";

// --- Types ---

export interface SubmagicCreateRequest {
  title: string;
  language: string;
  youtubeUrl: string;
  webhookUrl?: string;
  templateName?: string;
  userThemeId?: string;
  minClipLength?: number;
  maxClipLength?: number;
  faceTracking?: boolean;
}

export interface SubmagicCreateResponse {
  id: string;
  title: string;
  language: string;
  status: string;
  webhookUrl?: string;
  templateName?: string;
  userThemeId?: string;
  createdAt: string;
}

export interface SubmagicViralityScores {
  total: number;
  shareability: number;
  hook_strength: number;
  story_quality: number;
  emotional_impact: number;
}

export interface SubmagicClip {
  id: string;
  title: string;
  duration: number;
  viralityScores: SubmagicViralityScores;
  status: string;
  previewUrl: string;
  downloadUrl: string;
  directUrl: string;
}

export interface SubmagicProjectResponse {
  id: string;
  title: string;
  status: "processing" | "transcribing" | "exporting" | "completed" | "failed";
  duration?: number;
  magicClips?: SubmagicClip[];
}

// --- Helpers ---

export function isSubmagicConfigured(): boolean {
  return !!process.env.SUBMAGIC_API_KEY;
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.SUBMAGIC_API_KEY;
  if (!apiKey) {
    throw new Error("SUBMAGIC_API_KEY is not configured");
  }
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

// --- API calls ---

/**
 * Submit a YouTube video for Magic Clips processing.
 * Returns a project ID to poll for completion.
 * Consumes 1 Magic Clips credit.
 */
export async function createMagicClips(
  params: SubmagicCreateRequest
): Promise<SubmagicCreateResponse> {
  const response = await fetch(`${SUBMAGIC_API_BASE}/projects/magic-clips`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Submagic API error ${response.status}: ${body.message || body.error || response.statusText}`
    );
  }

  return response.json();
}

/**
 * Poll a project's status and retrieve clips when complete.
 */
export async function getProject(
  projectId: string
): Promise<SubmagicProjectResponse> {
  const response = await fetch(
    `${SUBMAGIC_API_BASE}/projects/${projectId}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Submagic API error ${response.status}: ${body.message || body.error || response.statusText}`
    );
  }

  return response.json();
}
