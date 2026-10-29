import { complete } from "@/lib/llm";
import { SegmentationParams, SegmentResult } from "./supabase/types";

/**
 * Segments blog content into multiple video-worthy chunks using Claude AI.
 * Each segment is designed to be a standalone video with unique hooks and minimal overlap.
 */
export async function segmentContent(
  params: SegmentationParams
): Promise<SegmentResult[]> {
  const { title, content, maxSegments, targetDurationPerSegment } = params;

  // Estimate words per segment based on speaking rate (150 wpm)
  const wordsPerMinute = 150;
  const targetWordsPerSegment = Math.round(
    (targetDurationPerSegment / 60) * wordsPerMinute
  );

  const systemPrompt = `You are an expert content strategist who segments long-form content into multiple engaging short-form video scripts.

Your task is to analyze blog content and create ${maxSegments} distinct video segments, each targeting approximately ${targetDurationPerSegment} seconds (${targetWordsPerSegment} words when spoken).

Guidelines for segmentation:
- Each segment must have a UNIQUE angle or hook - never repeat the same hook
- Segments should have minimal content overlap - each covers different aspects
- Each segment should work as a standalone video (no "part 1/2" references)
- Prioritize the most engaging, valuable, or surprising insights
- Each segment needs its own compelling hook that would stop a scroller
- Key points should be specific and actionable, not generic

You MUST respond with valid JSON only, no other text. The JSON should be an array of segment objects.`;

  const userPrompt = `Segment this blog post into ${maxSegments} distinct video segments:

Title: ${title}

Content:
${content.slice(0, 12000)}

For each segment, provide:
1. A unique, attention-grabbing title (not the original blog title)
2. The focused content for that segment (the actual text/talking points)
3. 3-5 specific key points that will be covered
4. Estimated duration in seconds

Respond with a JSON array of objects with this exact structure:
[
  {
    "title": "Attention-grabbing segment title",
    "content": "The focused content for this segment covering one angle of the topic...",
    "keyPoints": ["Specific point 1", "Specific point 2", "Specific point 3"],
    "estimatedDuration": ${targetDurationPerSegment}
  }
]

Remember: Each segment must have a DIFFERENT hook and cover DIFFERENT aspects of the content. No overlap allowed.`;

  const responseText = (await complete({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 4096,
  })).trim();

  // Handle potential markdown code blocks in response
  let jsonText = responseText;
  if (responseText.startsWith("```")) {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }
  }

  let segments: SegmentResult[];
  try {
    segments = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${responseText.slice(0, 200)}`);
  }

  // Validate the response structure
  if (!Array.isArray(segments)) {
    throw new Error("Claude response is not an array of segments");
  }

  // Validate and normalize each segment
  const validatedSegments: SegmentResult[] = segments.map((seg, index) => {
    if (!seg.title || typeof seg.title !== "string") {
      throw new Error(`Segment ${index} missing valid title`);
    }
    if (!seg.content || typeof seg.content !== "string") {
      throw new Error(`Segment ${index} missing valid content`);
    }
    if (!Array.isArray(seg.keyPoints)) {
      throw new Error(`Segment ${index} missing valid keyPoints array`);
    }

    return {
      title: seg.title,
      content: seg.content,
      keyPoints: seg.keyPoints.map((kp: unknown) => String(kp)),
      estimatedDuration: typeof seg.estimatedDuration === "number"
        ? seg.estimatedDuration
        : targetDurationPerSegment,
    };
  });

  // Ensure we don't return more segments than requested
  return validatedSegments.slice(0, maxSegments);
}
