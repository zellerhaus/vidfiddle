import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_CAPTION_PRESETS } from "@/lib/creatomate";
import type { CaptionStylePreset } from "@/lib/supabase/types";

const SETTINGS_KEY = "caption_style_presets";

/**
 * GET /api/youtube/caption-styles
 * Return available caption style presets.
 */
export async function GET() {
  try {
    const [setting] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1)
      .catch(() => []);

    // Return saved presets or defaults
    const presets: CaptionStylePreset[] = setting?.value
      ? (setting.value as unknown as CaptionStylePreset[])
      : DEFAULT_CAPTION_PRESETS;

    return NextResponse.json({ presets });
  } catch (error) {
    console.error("Error fetching caption styles:", error);
    return NextResponse.json({ presets: DEFAULT_CAPTION_PRESETS });
  }
}

/**
 * POST /api/youtube/caption-styles
 * Save custom caption style presets.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { presets } = body;

    if (!Array.isArray(presets)) {
      return NextResponse.json(
        { error: "presets must be an array" },
        { status: 400 }
      );
    }

    try {
      await db
        .insert(settings)
        .values({ key: SETTINGS_KEY, value: presets })
        .onConflictDoUpdate({
          target: settings.key,
          set: { key: SETTINGS_KEY, value: presets },
        });
    } catch {
      return NextResponse.json(
        { error: "Failed to save caption styles" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, presets });
  } catch (error) {
    console.error("Error saving caption styles:", error);
    return NextResponse.json(
      { error: "Failed to save caption styles" },
      { status: 500 }
    );
  }
}
