import type { BrandGuidelineTyped } from "@/lib/supabase/types";
import { complete, isLLMConfigured } from "@/lib/llm";

export interface ScriptGenerationParams {
  title: string;
  content: string;
  targetDuration?: number; // in seconds, default 30-60
  style?: "informative" | "entertaining" | "professional";
  tone?: "casual" | "formal" | "energetic";
  brandGuideline?: BrandGuidelineTyped | null;
}

export interface GeneratedScript {
  script: string;
  estimatedDuration: number;
  wordCount: number;
  hooks: string[];
}

export interface CaptionGenerationParams {
  script: string;
  platform: "instagram" | "tiktok" | "youtube" | "linkedin" | "twitter" | "facebook";
  includeHashtags?: boolean;
  includeCTA?: boolean;
}

export interface GeneratedCaption {
  caption: string;
  hashtags: string[];
  characterCount: number;
}

const PLATFORM_LIMITS: Record<string, number> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  linkedin: 3000,
  twitter: 280,
  facebook: 63206,
};

const PLATFORM_GUIDELINES: Record<string, string> = {
  instagram: "Limited emojis, line breaks for readability, strong CTA, trending hashtags",
  tiktok: "Keep it punchy, use trending sounds references, viral hashtags, Gen-Z friendly",
  youtube: "Include keywords for SEO, subscribe CTA",
  linkedin: "Professional tone, industry insights, thought leadership, minimal emojis",
  twitter: "Concise, provocative hook, thread-friendly",
  facebook: "Conversational, shareable, community-focused, questions",
};

/**
 * Build brand guidelines section for system prompt
 */
function buildBrandGuidelinesPrompt(guideline: BrandGuidelineTyped): string {
  const sections: string[] = [];

  sections.push("\n## Brand Voice Guidelines");
  sections.push(`Brand: ${guideline.name}`);

  if (guideline.voice_description) {
    sections.push(`\nVoice & Personality: ${guideline.voice_description}`);
  }

  if (guideline.target_audience) {
    sections.push(`\nTarget Audience: ${guideline.target_audience}`);
  }

  if (guideline.tone_guidelines) {
    sections.push(`\nTone Guidelines: ${guideline.tone_guidelines}`);
  }

  if (guideline.terminology && guideline.terminology.length > 0) {
    sections.push(`\nKey Terminology to Use: ${guideline.terminology.join(", ")}`);
  }

  if (guideline.content_restrictions) {
    sections.push(`\nContent Restrictions (AVOID): ${guideline.content_restrictions}`);
  }

  if (guideline.example_phrases && guideline.example_phrases.length > 0) {
    sections.push("\nExample Phrases That Embody the Brand Voice:");
    guideline.example_phrases.forEach((phrase) => {
      sections.push(`- "${phrase}"`);
    });
  }

  sections.push("\nIMPORTANT: Apply these brand guidelines throughout the script while maintaining natural flow.");

  return sections.join("\n");
}

export async function generateScript(
  params: ScriptGenerationParams
): Promise<GeneratedScript> {
  const {
    title,
    content,
    targetDuration = 45,
    style = "informative",
    tone = "casual",
    brandGuideline,
  } = params;

  const wordsPerMinute = 150; // Average speaking rate
  // Use a 10% buffer below target so scripts stay under the billing threshold
  // (Creatify charges per 30-second block, so even 1 second over = next tier)
  const maxWordCount = Math.floor((targetDuration / 60) * wordsPerMinute * 0.9);
  const targetWordCount = Math.round((targetDuration / 60) * wordsPerMinute * 0.85);

  let systemPrompt = `You are an expert video script writer who creates engaging short-form video content.
Your scripts are designed to be spoken aloud with visuals (stock footage or AI avatar).
Write in a ${style} style with a ${tone} tone.
Target ${targetWordCount} words. STRICT MAXIMUM: ${maxWordCount} words. Never exceed this limit.
This produces a ~${targetDuration}-second video when spoken at a natural pace.

Format guidelines:
- Start with a compelling hook (first 3 seconds are critical)
- Use short, punchy sentences
- Include natural pauses indicated by "..."
- Write conversationally, as if talking to one person
- End with a clear takeaway or call-to-action
- Do NOT include stage directions, camera notes, or [brackets]
- Write the actual words to be spoken only
- Keep the script CONCISE — every word must earn its place`;

  // Add brand guidelines if provided
  if (brandGuideline) {
    systemPrompt += buildBrandGuidelinesPrompt(brandGuideline);
  }

  const userPrompt = `Convert this blog post into an engaging video script:

Title: ${title}

Content:
${content.slice(0, 8000)} // Limit content to avoid token limits

Create a video script (max ${maxWordCount} words) that captures the key insights and makes viewers want to engage.`;

  const script = (await complete({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 1024,
  })).trim();
  const wordCount = script.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / wordsPerMinute) * 60);

  // Extract potential hooks (first sentence variations)
  const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const hooks = sentences.slice(0, 3).map(s => s.trim());

  return {
    script,
    estimatedDuration,
    wordCount,
    hooks,
  };
}

export async function generateCaption(
  params: CaptionGenerationParams
): Promise<GeneratedCaption> {
  const { script, platform, includeHashtags = true, includeCTA = true } = params;

  const charLimit = PLATFORM_LIMITS[platform];
  const guidelines = PLATFORM_GUIDELINES[platform];

  const systemPrompt = `You are a social media expert who writes high-converting captions.
Platform: ${platform}
Character limit: ${charLimit}
Guidelines: ${guidelines}

Create captions that drive engagement and complement the video content.`;

  const userPrompt = `Write a ${platform} caption for this video script:

${script}

Requirements:
- Stay under ${charLimit} characters
${includeHashtags ? "- Include 3-5 relevant hashtags" : "- No hashtags"}
${includeCTA ? "- Include a call-to-action" : ""}
- Match the platform's native style

Return the caption only, no explanations.`;

  const caption = (await complete({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 512,
  })).trim();

  // Extract hashtags from caption
  const hashtagRegex = /#\w+/g;
  const hashtags = caption.match(hashtagRegex) || [];

  return {
    caption,
    hashtags,
    characterCount: caption.length,
  };
}

export async function generateMultipleCaptions(
  script: string,
  platforms: string[]
): Promise<Record<string, GeneratedCaption>> {
  const results: Record<string, GeneratedCaption> = {};

  // Generate captions in parallel
  const promises = platforms.map(async (platform) => {
    const caption = await generateCaption({
      script,
      platform: platform as CaptionGenerationParams["platform"],
    });
    return { platform, caption };
  });

  const captions = await Promise.all(promises);

  for (const { platform, caption } of captions) {
    results[platform] = caption;
  }

  return results;
}

export interface RegenerateScriptParams {
  originalScript: string;
  blogContent: string;
  feedback: string;
  targetDuration?: number;
  style?: "informative" | "entertaining" | "professional";
  tone?: "casual" | "formal" | "energetic";
  brandGuideline?: BrandGuidelineTyped | null;
}

export async function regenerateScriptWithFeedback(
  params: RegenerateScriptParams
): Promise<GeneratedScript> {
  const {
    originalScript,
    blogContent,
    feedback,
    targetDuration = 45,
    style = "informative",
    tone = "casual",
    brandGuideline,
  } = params;

  const wordsPerMinute = 150;
  const maxWordCount = Math.floor((targetDuration / 60) * wordsPerMinute * 0.9);
  const targetWordCount = Math.round((targetDuration / 60) * wordsPerMinute * 0.85);

  let systemPrompt = `You are an expert video script writer who creates engaging short-form video content.
Your task is to IMPROVE an existing video script based on user feedback.
Write in a ${style} style with a ${tone} tone.
Target ${targetWordCount} words. STRICT MAXIMUM: ${maxWordCount} words. Never exceed this limit.
This produces a ~${targetDuration}-second video when spoken at a natural pace.

Format guidelines:
- Start with a compelling hook (first 3 seconds are critical)
- Use short, punchy sentences
- Include natural pauses indicated by "..."
- Write conversationally, as if talking to one person
- End with a clear takeaway or call-to-action
- Do NOT include stage directions, camera notes, or [brackets]
- Write the actual words to be spoken only
- Keep the script CONCISE — every word must earn its place

IMPORTANT: Carefully incorporate the user's feedback to improve the script.`;

  // Add brand guidelines if provided
  if (brandGuideline) {
    systemPrompt += buildBrandGuidelinesPrompt(brandGuideline);
  }

  const userPrompt = `Here is the original video script that needs improvement:

--- ORIGINAL SCRIPT ---
${originalScript}
--- END ORIGINAL SCRIPT ---

User feedback for improvement:
${feedback}

Original blog content for reference:
${blogContent.slice(0, 6000)}

Please generate an improved version of the script that addresses the user's feedback while maintaining the core message. The improved script must be no more than ${maxWordCount} words.

Return ONLY the improved script text, no explanations or commentary.`;

  const script = (await complete({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 1024,
  })).trim();
  const wordCount = script.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / wordsPerMinute) * 60);

  // Extract potential hooks (first sentence variations)
  const sentences = script.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const hooks = sentences.slice(0, 3).map((s) => s.trim());

  return {
    script,
    estimatedDuration,
    wordCount,
    hooks,
  };
}

export function isClaudeConfigured(): boolean {
  return isLLMConfigured(); // Kept for existing callers.
}

/**
 * Convert a raw BrandGuideline from the database to the typed version
 */
export function parseBrandGuideline(raw: {
  id: string;
  name: string;
  is_default: boolean;
  voice_description: string | null;
  target_audience: string | null;
  terminology: unknown;
  tone_guidelines: string | null;
  content_restrictions: string | null;
  example_phrases: unknown;
  created_at: string;
  updated_at: string;
}): BrandGuidelineTyped {
  return {
    id: raw.id,
    name: raw.name,
    is_default: raw.is_default,
    voice_description: raw.voice_description,
    target_audience: raw.target_audience,
    terminology: Array.isArray(raw.terminology)
      ? (raw.terminology as string[])
      : [],
    tone_guidelines: raw.tone_guidelines,
    content_restrictions: raw.content_restrictions,
    example_phrases: Array.isArray(raw.example_phrases)
      ? (raw.example_phrases as string[])
      : [],
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}
