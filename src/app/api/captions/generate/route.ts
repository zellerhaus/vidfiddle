import { NextRequest, NextResponse } from "next/server";
import { generateMultipleCaptions, isClaudeConfigured } from "@/lib/claude";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import type { Platform } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  try {
    if (!isClaudeConfigured()) {
      return NextResponse.json(
        { error: "Claude API is not configured" },
        { status: 503 }
      );
    }

    const { script, platforms, videoId, regenerate } = await request.json();

    if (!script) {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 }
      );
    }

    const targetPlatforms: Platform[] = platforms || [
      "instagram",
      "tiktok",
      "youtube",
      "linkedin",
      "twitter",
      "facebook",
    ];

    // If videoId provided, check for cached captions (unless regenerating)
    if (videoId && !regenerate) {
      const [video] = await db
        .select({ generated_captions: videos.generated_captions })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1)
        .catch(() => []);

      if (video?.generated_captions) {
        const cached = video.generated_captions as Record<string, string>;
        // Check if all requested platforms have cached captions
        const allCached = targetPlatforms.every((p) => cached[p]);
        if (allCached) {
          // Return cached captions
          const captions: Record<string, string> = {};
          for (const platform of targetPlatforms) {
            captions[platform] = cached[platform];
          }
          return NextResponse.json({ captions, cached: true });
        }
      }
    }

    const captionResults = await generateMultipleCaptions(script, targetPlatforms);

    // Extract just the caption strings for the frontend
    const captions: Record<string, string> = {};
    for (const [platform, result] of Object.entries(captionResults)) {
      captions[platform] = result.caption;
    }

    // Save captions to database if videoId provided
    if (videoId) {
      // First get existing captions to merge with new ones
      const [video] = await db
        .select({ generated_captions: videos.generated_captions })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1)
        .catch(() => []);

      const existingCaptions = (video?.generated_captions as Record<string, string>) || {};
      const mergedCaptions = { ...existingCaptions, ...captions };

      await db
        .update(videos)
        .set({ generated_captions: mergedCaptions })
        .where(eq(videos.id, videoId))
        .catch(() => {});
    }

    return NextResponse.json({ captions });
  } catch (error) {
    console.error("Error generating captions:", error);
    return NextResponse.json(
      { error: "Failed to generate captions" },
      { status: 500 }
    );
  }
}
