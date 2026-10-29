const CREATIFY_API_URL = "https://api.creatify.ai/api";

function getHeaders(): Record<string, string> {
  return {
    "X-API-ID": process.env.CREATIFY_API_ID!,
    "X-API-KEY": process.env.CREATIFY_API_KEY!,
    "Content-Type": "application/json",
  };
}

// ============================================================
// Common types
// ============================================================

export type CreatifyAspectRatio = "9x16" | "16x9" | "1x1";

export type CreatifyStatus =
  | "pending"
  | "in_queue"
  | "running"
  | "failed"
  | "done"
  | "rejected";

export type CreatifyModelVersion = "standard" | "aurora_v1" | "aurora_v1_fast";

export type CreatifyTargetPlatform =
  | "tiktok"
  | "youtube_shorts"
  | "instagram_reels"
  | "other";

export interface CaptionSetting {
  enabled?: boolean;
  style?: string;
}

// ============================================================
// Legacy AI Shorts types (deprecated but kept for backward compat)
// ============================================================

export type CreatifyStyle =
  | "4K realistic"
  | "3D"
  | "Cinematic"
  | "Cartoonish"
  | "Line art"
  | "Pixel art"
  | "Mysterious"
  | "Steam punk"
  | "Collage"
  | "Kawaii";

export interface CreateShortsParams {
  script: string;
  aspect_ratio: CreatifyAspectRatio;
  style: CreatifyStyle;
  accent?: string | null;
  caption_setting?: CaptionSetting | null;
  background_music_url?: string | null;
  background_music_volume?: number | null;
  voiceover_volume?: number | null;
  webhook_url?: string | null;
  name?: string;
}

// ============================================================
// New Link-to-Video types
// ============================================================

export interface CreateLinkParams {
  title: string;
  description: string;
  image_urls?: string[];
  video_urls?: string[];
}

export interface CreatifyLink {
  id: string; // UUID to use in link_to_videos
}

export interface CreateLinkToVideoParams {
  link: string; // UUID from createLinkWithParams
  override_script?: string;
  visual_style?: string; // e.g. "AvatarBubbleTemplate", "MagazineTemplate"
  script_style?: string; // e.g. "DiscoveryWriter", "StorytellerPro"
  video_length?: number; // 15, 30, 45, or 60
  aspect_ratio?: CreatifyAspectRatio;
  target_platform?: CreatifyTargetPlatform;
  model_version?: CreatifyModelVersion;
  override_avatar?: string; // avatar UUID
  override_voice?: string; // voice UUID
}

// ============================================================
// New Lipsync V2 types
// ============================================================

export interface LipsyncV2Character {
  type: "avatar";
  avatar_id: string;
  avatar_style?: string;
}

export interface LipsyncV2Voice {
  type: "text";
  voice_id: string;
  input_text: string;
}

export interface LipsyncV2Background {
  type: "ai_generated" | "image" | "video" | "color";
  url?: string;
  color?: string;
}

export interface LipsyncV2VideoInput {
  character: LipsyncV2Character;
  voice: LipsyncV2Voice;
  background?: LipsyncV2Background;
}

export interface CreateLipsyncV2Params {
  video_inputs: LipsyncV2VideoInput[];
  aspect_ratio?: CreatifyAspectRatio;
  model_version?: CreatifyModelVersion;
  caption_setting?: CaptionSetting | null;
}

// ============================================================
// Shared job response type (works for both new APIs)
// ============================================================

export interface CreatifyJob {
  id: string;
  status: CreatifyStatus;
  failed_reason: string;
  video_output: string | null;
  preview: string | null;
  editor_url: string | null;
  is_hidden: boolean;
  progress: number;
  credits_used: number;
  duration: number;
  created_at: string;
  updated_at: string;
  script: string | null;
  aspect_ratio: CreatifyAspectRatio;
  style: CreatifyStyle;
}

/**
 * Create an AI Shorts video task
 * Costs 5 credits per 30 seconds of video
 */
export async function createAIShorts(params: CreateShortsParams): Promise<CreatifyJob> {
  // Build request body with only defined values (API may reject nulls)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = {
    script: params.script,
    aspect_ratio: params.aspect_ratio,
    style: params.style,
  };

  // Only include optional fields if they have values
  if (params.accent) requestBody.accent = params.accent;
  if (params.caption_setting) requestBody.caption_setting = params.caption_setting;
  if (params.background_music_url) requestBody.background_music_url = params.background_music_url;
  if (params.background_music_volume !== undefined && params.background_music_volume !== null) {
    requestBody.background_music_volume = params.background_music_volume;
  }
  if (params.voiceover_volume !== undefined && params.voiceover_volume !== null) {
    requestBody.voiceover_volume = params.voiceover_volume;
  }
  if (params.webhook_url) requestBody.webhook_url = params.webhook_url;
  if (params.name) requestBody.name = params.name;

  console.log("[Creatify] Creating AI Shorts with:", {
    ...requestBody,
    script: requestBody.script.slice(0, 100) + "...",
  });

  // Note: Creatify API requires trailing slash
  const response = await fetch(`${CREATIFY_API_URL}/ai_shorts/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log("[Creatify] Response status:", response.status);
  console.log("[Creatify] Response body:", responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to create AI Shorts: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Creatify] Parsed job ID:", data.id);
  return data;
}

/**
 * Get list of AI Shorts jobs
 */
export async function getAIShorts(): Promise<CreatifyJob[]> {
  // Note: Creatify API requires trailing slash
  const response = await fetch(`${CREATIFY_API_URL}/ai_shorts/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get AI Shorts: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Handle paginated response (API returns { results: [], count: N, ... })
  if (data.results && Array.isArray(data.results)) {
    return data.results;
  }

  // Handle direct array response
  if (Array.isArray(data)) {
    return data;
  }

  console.warn("Unexpected Creatify response format:", data);
  return [];
}

/**
 * Get a single AI Shorts job by ID
 * Uses the /api/ai_shorts/{id}/ endpoint
 */
export async function getAIShortsById(id: string): Promise<CreatifyJob | null> {
  // Note: Creatify API requires trailing slash
  const response = await fetch(`${CREATIFY_API_URL}/ai_shorts/${id}/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.text();
    throw new Error(`Failed to get AI Short: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log("[Creatify] Got job by ID:", { id: data.id, status: data.status });
  return data;
}

// ============================================================
// New Link-to-Video API (replaces ai_shorts)
// ============================================================

/**
 * Step 1a: Create a link from a URL (Creatify scrapes it)
 * Use this when you have a blog URL but no images/videos to pass.
 */
export async function createLinkFromUrl(url: string): Promise<CreatifyLink> {
  console.log("[Creatify] Creating link from URL:", url);

  const response = await fetch(`${CREATIFY_API_URL}/links/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ url }),
  });

  const responseText = await response.text();
  console.log("[Creatify] Link from URL response status:", response.status);
  console.log("[Creatify] Link from URL response body:", responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to create link from URL: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Creatify] Created link ID from URL:", data.id);
  return data;
}

/**
 * Step 1b: Create a link with params (title, description, images/videos)
 * This creates a "link" resource that can be used to generate a video.
 * Requires at least one image or video URL.
 */
export async function createLinkWithParams(params: CreateLinkParams): Promise<CreatifyLink> {
  const requestBody = {
    title: params.title,
    description: params.description,
    image_urls: params.image_urls || [],
    video_urls: params.video_urls || [],
  };

  console.log("[Creatify] Creating link with params:", {
    title: requestBody.title,
    description: requestBody.description.slice(0, 100) + "...",
    image_urls: requestBody.image_urls.length,
    video_urls: requestBody.video_urls.length,
  });

  const response = await fetch(`${CREATIFY_API_URL}/links/link_with_params/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log("[Creatify] Link creation response status:", response.status);
  console.log("[Creatify] Link creation response body:", responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to create link: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Creatify] Created link ID:", data.id);
  return data;
}

/**
 * Step 2: Create a video from a link UUID
 * Uses the link created in step 1 to generate a video with specified styles.
 */
export async function createLinkToVideo(params: CreateLinkToVideoParams): Promise<CreatifyJob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = {
    link: params.link,
  };

  if (params.override_script) requestBody.override_script = params.override_script;
  if (params.visual_style) requestBody.visual_style = params.visual_style;
  if (params.script_style) requestBody.script_style = params.script_style;
  if (params.video_length) requestBody.video_length = params.video_length;
  if (params.aspect_ratio) requestBody.aspect_ratio = params.aspect_ratio;
  if (params.target_platform) requestBody.target_platform = params.target_platform;
  if (params.model_version) requestBody.model_version = params.model_version;
  if (params.override_avatar) requestBody.override_avatar = params.override_avatar;
  if (params.override_voice) requestBody.override_voice = params.override_voice;

  console.log("[Creatify] Creating link-to-video with:", {
    link: params.link,
    visual_style: params.visual_style,
    video_length: params.video_length,
    aspect_ratio: params.aspect_ratio,
    model_version: params.model_version,
  });

  const response = await fetch(`${CREATIFY_API_URL}/link_to_videos/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log("[Creatify] Link-to-video response status:", response.status);
  console.log("[Creatify] Link-to-video response body:", responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to create link-to-video: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Creatify] Link-to-video job ID:", data.id);
  return data;
}

/**
 * Get a link-to-video job by ID
 */
export async function getLinkToVideoById(id: string): Promise<CreatifyJob | null> {
  const response = await fetch(`${CREATIFY_API_URL}/link_to_videos/${id}/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.text();
    throw new Error(`Failed to get link-to-video: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log("[Creatify] Got link-to-video by ID:", { id: data.id, status: data.status });
  return data;
}

// ============================================================
// New Lipsync V2 API (AI Avatar videos)
// ============================================================

/**
 * Create an AI Avatar video using Lipsync V2
 */
export async function createLipsyncV2(params: CreateLipsyncV2Params): Promise<CreatifyJob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = {
    video_inputs: params.video_inputs,
  };

  if (params.aspect_ratio) requestBody.aspect_ratio = params.aspect_ratio;
  if (params.model_version) requestBody.model_version = params.model_version;
  if (params.caption_setting) requestBody.caption_setting = params.caption_setting;

  console.log("[Creatify] Creating lipsync V2 with:", {
    inputs: params.video_inputs.length,
    aspect_ratio: params.aspect_ratio,
    model_version: params.model_version,
  });

  const response = await fetch(`${CREATIFY_API_URL}/lipsyncs_v2/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log("[Creatify] Lipsync V2 response status:", response.status);
  console.log("[Creatify] Lipsync V2 response body:", responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to create lipsync V2: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log("[Creatify] Lipsync V2 job ID:", data.id);
  return data;
}

/**
 * Get a lipsync V2 job by ID
 */
export async function getLipsyncV2ById(id: string): Promise<CreatifyJob | null> {
  const response = await fetch(`${CREATIFY_API_URL}/lipsyncs_v2/${id}/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.text();
    throw new Error(`Failed to get lipsync V2: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log("[Creatify] Got lipsync V2 by ID:", { id: data.id, status: data.status });
  return data;
}

// ============================================================
// Helper/mapping functions
// ============================================================

/**
 * Map our app's video style to Creatify style
 */
export function mapToCreatifyStyle(appStyle: string): CreatifyStyle {
  // Default mapping - can be customized based on user preferences
  const styleMap: Record<string, CreatifyStyle> = {
    stock_footage: "4K realistic",
    ai_avatar: "Cinematic",
    text_on_screen: "Cinematic",
  };
  return styleMap[appStyle] || "4K realistic";
}

/**
 * Map aspect ratio format (our format to Creatify format)
 */
export function mapAspectRatio(ratio: string): CreatifyAspectRatio {
  const ratioMap: Record<string, CreatifyAspectRatio> = {
    "9:16": "9x16",
    "16:9": "16x9",
    "1:1": "1x1",
  };
  return ratioMap[ratio] || "9x16";
}

/**
 * Check if a job is complete (done or failed)
 */
export function isJobComplete(status: CreatifyStatus): boolean {
  return status === "done" || status === "failed" || status === "rejected";
}

/**
 * Check if a job succeeded
 */
export function isJobSuccessful(status: CreatifyStatus): boolean {
  return status === "done";
}

/**
 * Check if Creatify is configured
 */
export function isCreatifyConfigured(): boolean {
  return !!process.env.CREATIFY_API_ID && !!process.env.CREATIFY_API_KEY;
}

// Legacy styles for UI selection (ai_shorts API)
export const CREATIFY_STYLES: { value: CreatifyStyle; label: string; description: string }[] = [
  { value: "4K realistic", label: "4K Realistic", description: "High-quality realistic footage" },
  { value: "Cinematic", label: "Cinematic", description: "Movie-like visual style" },
  { value: "3D", label: "3D", description: "Three-dimensional rendered style" },
  { value: "Cartoonish", label: "Cartoonish", description: "Fun cartoon-style visuals" },
  { value: "Kawaii", label: "Kawaii", description: "Cute Japanese-inspired style" },
  { value: "Line art", label: "Line Art", description: "Clean line drawing style" },
  { value: "Pixel art", label: "Pixel Art", description: "Retro pixel graphics" },
  { value: "Mysterious", label: "Mysterious", description: "Dark, atmospheric style" },
  { value: "Steam punk", label: "Steampunk", description: "Victorian-era mechanical aesthetic" },
  { value: "Collage", label: "Collage", description: "Mixed media collage style" },
];

export const CREATIFY_ASPECT_RATIOS: { value: CreatifyAspectRatio; label: string; description: string }[] = [
  { value: "9x16", label: "9:16 (Vertical)", description: "TikTok, Reels, Shorts" },
  { value: "16x9", label: "16:9 (Horizontal)", description: "YouTube, LinkedIn" },
  { value: "1x1", label: "1:1 (Square)", description: "Instagram Feed" },
];

// Visual styles for Link-to-Video API (new)
export const LINK_TO_VIDEO_VISUAL_STYLES: { value: string; label: string }[] = [
  { value: "VanillaTemplate", label: "Classic" },
  { value: "EnhancedVanillaTemplate", label: "Enhanced Classic" },
  { value: "FullScreenTemplate", label: "Full Screen" },
  { value: "FullScreenV2Template", label: "Full Screen V2" },
  { value: "AvatarBubbleTemplate", label: "Avatar Bubble" },
  { value: "DramaticTemplate", label: "Dramatic" },
  { value: "SideBySideTemplate", label: "Side by Side" },
  { value: "TopBottomTemplate", label: "Top & Bottom" },
  { value: "FeatureHighlightTemplate", label: "Feature Highlight" },
  { value: "QuickTransitionTemplate", label: "Quick Transition" },
  { value: "QuickFrameTemplate", label: "Quick Frame" },
  { value: "MotionCardsTemplate", label: "Motion Cards" },
  { value: "OverCardsTemplate", label: "Over Cards" },
  { value: "VlogTemplate", label: "Vlog" },
  { value: "ScribbleTemplate", label: "Scribble" },
  { value: "SimpleAvatarOverlayTemplate", label: "Avatar Overlay" },
  { value: "GreenScreenEffectTemplate", label: "Green Screen" },
  { value: "DynamicGreenScreenEffect", label: "Dynamic Green Screen" },
  { value: "DynamicProductTemplate", label: "Dynamic Product" },
  { value: "DynamicResponseBubbleTemplate", label: "Response Bubble" },
  { value: "TwitterFrameTemplate", label: "Twitter Frame" },
];

// Video length options for Link-to-Video API
export const LINK_TO_VIDEO_LENGTHS: { value: number; label: string }[] = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 45, label: "45 seconds" },
  { value: 60, label: "60 seconds" },
];

// Model version options
export const CREATIFY_MODEL_VERSIONS: { value: CreatifyModelVersion; label: string; description: string }[] = [
  { value: "standard", label: "Standard", description: "Default quality" },
  { value: "aurora_v1", label: "Aurora V1", description: "Higher quality, slower" },
  { value: "aurora_v1_fast", label: "Aurora V1 Fast", description: "Fast generation" },
];

/**
 * Map our app's video style to a visual_style for the new Link-to-Video API
 */
export function mapToVisualStyle(appStyle: string): string {
  const styleMap: Record<string, string> = {
    stock_footage: "FullScreenTemplate",
    ai_avatar: "AvatarBubbleTemplate",
    text_on_screen: "EnhancedVanillaTemplate",
  };
  return styleMap[appStyle] || "FullScreenTemplate";
}

/**
 * Map video length from seconds to closest valid Creatify value
 */
export function mapVideoLength(seconds: number): number {
  if (seconds <= 15) return 15;
  if (seconds <= 30) return 30;
  if (seconds <= 45) return 45;
  return 60;
}

// ============================================================
// Account / Credits
// ============================================================

export interface CreatifyCredits {
  remaining_credits: number;
}

/**
 * Get remaining Creatify credits for the workspace
 */
export async function getRemainingCredits(): Promise<CreatifyCredits> {
  const response = await fetch(`${CREATIFY_API_URL}/remaining_credits/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get remaining credits: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Avatar available in Creatify (for Lipsync V2)
 */
export interface CreatifyAvatar {
  id: string;
  name: string;
  thumbnail_url: string;
}

/**
 * Get list of available avatars from Creatify
 * These are used for the AI Avatar in Lipsync V2
 */
export async function getAvatars(): Promise<CreatifyAvatar[]> {
  const response = await fetch(`${CREATIFY_API_URL}/personas/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get avatars: ${response.status} - ${error}`);
  }

  const data = await response.json();

  function mapAvatar(avatar: Record<string, unknown>): CreatifyAvatar {
    return {
      id: (avatar.id ?? avatar.avatar_id ?? "") as string,
      name: (avatar.name ?? avatar.label ?? "") as string,
      thumbnail_url: (avatar.thumbnail_url ?? avatar.thumbnail ?? avatar.image_url ?? "") as string,
    };
  }

  // Handle paginated response
  if (data.results && Array.isArray(data.results)) {
    return data.results.map(mapAvatar);
  }

  // Handle direct array response
  if (Array.isArray(data)) {
    return data.map(mapAvatar);
  }

  console.warn("Unexpected Creatify avatars response format:", data);
  return [];
}

/**
 * Voice/Accent available in Creatify
 */
export interface CreatifyVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

/**
 * Get list of available voices from Creatify
 * These are used for the voiceover in AI Shorts
 */
export async function getVoices(): Promise<CreatifyVoice[]> {
  // Note: Creatify API requires trailing slash
  const response = await fetch(`${CREATIFY_API_URL}/voices/`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get voices: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Log first voice to see actual field names from API
  const sampleVoice = Array.isArray(data) ? data[0] : data.results?.[0];
  if (sampleVoice) {
    console.log("[creatify] Sample voice fields:", Object.keys(sampleVoice), JSON.stringify(sampleVoice).slice(0, 500));
  }

  function mapVoice(voice: Record<string, unknown>): CreatifyVoice {
    return {
      id: (voice.id ?? voice.voice_id ?? "") as string,
      name: (voice.name ?? voice.label ?? "") as string,
      language: (voice.language ?? voice.locale ?? voice.lang ?? voice.accent ?? "Unknown") as string,
      gender: (voice.gender ?? voice.sex ?? "Unknown") as string,
    };
  }

  // Handle paginated response (API returns { results: [], count: N, ... })
  if (data.results && Array.isArray(data.results)) {
    return data.results.map(mapVoice);
  }

  // Handle direct array response
  if (Array.isArray(data)) {
    return data.map(mapVoice);
  }

  console.warn("Unexpected Creatify voices response format:", data);
  return [];
}
