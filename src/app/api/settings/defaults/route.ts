import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { isCreatifyConfigured } from "@/lib/creatify";
import { isLocalEngineConfigured } from "@/lib/local-engine";
import type { VideoDefaults } from "@/lib/supabase/types";

const SETTINGS_KEY = "video_defaults";

// Default values when no settings exist
const DEFAULT_VIDEO_SETTINGS: VideoDefaults = {
  apiMethod: "ai_shorts",
  creatifyStyle: "stock_footage",
  visualStyle: "FullScreenTemplate",
  videoLength: 30,
  avatarId: null,
  aspectRatio: "9:16",
  voiceId: null,
  voiceoverVolume: 80,
  backgroundMusicVolume: 30,
  targetDuration: 60,
  scriptStyle: "engaging",
  scriptTone: "professional",
};

function getDefaultVideoSettings(): VideoDefaults {
  if (!isCreatifyConfigured() && isLocalEngineConfigured()) {
    return {
      ...DEFAULT_VIDEO_SETTINGS,
      apiMethod: "local",
      visualStyle: undefined,
    };
  }

  return DEFAULT_VIDEO_SETTINGS;
}

export async function GET() {
  try {
    const [data] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    // Return stored defaults or default values
    const defaults = data?.value as VideoDefaults | null;
    const fallback = getDefaultVideoSettings();
    return NextResponse.json({
      ...(defaults
        ? {
            ...defaults,
            apiMethod: defaults.apiMethod ?? fallback.apiMethod,
          }
        : fallback),
      capabilities: {
        creatifyConfigured: isCreatifyConfigured(),
        localEngineConfigured: isLocalEngineConfigured(),
        preferredApiMethod: fallback.apiMethod,
      },
    });
  } catch (error) {
    console.error("Error fetching video defaults:", error);
    return NextResponse.json(
      { error: "Failed to fetch video defaults" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields: (keyof VideoDefaults)[] = [
      "apiMethod",
      "creatifyStyle",
      "aspectRatio",
      "voiceoverVolume",
      "backgroundMusicVolume",
      "targetDuration",
      "scriptStyle",
      "scriptTone",
    ];

    for (const field of requiredFields) {
      if (body[field] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate API method
    const validApiMethods = ["ai_shorts", "link_to_video", "lipsync_v2", "local"];
    if (!validApiMethods.includes(body.apiMethod)) {
      return NextResponse.json(
        { error: "Invalid API method. Must be one of: ai_shorts, link_to_video, lipsync_v2, local" },
        { status: 400 }
      );
    }

    // Validate aspect ratio
    const validAspectRatios = ["9:16", "16:9", "1:1"];
    if (!validAspectRatios.includes(body.aspectRatio)) {
      return NextResponse.json(
        { error: "Invalid aspect ratio. Must be one of: 9:16, 16:9, 1:1" },
        { status: 400 }
      );
    }

    // Validate volume ranges (0-100)
    if (
      body.voiceoverVolume < 0 ||
      body.voiceoverVolume > 100 ||
      body.backgroundMusicVolume < 0 ||
      body.backgroundMusicVolume > 100
    ) {
      return NextResponse.json(
        { error: "Volume values must be between 0 and 100" },
        { status: 400 }
      );
    }

    // Validate target duration (30-90 seconds)
    if (body.targetDuration < 30 || body.targetDuration > 90) {
      return NextResponse.json(
        { error: "Target duration must be between 30 and 90 seconds" },
        { status: 400 }
      );
    }

    const defaults: VideoDefaults = {
      apiMethod: body.apiMethod,
      creatifyStyle: body.creatifyStyle,
      visualStyle: body.visualStyle ?? "FullScreenTemplate",
      videoLength: body.videoLength ?? 30,
      avatarId: body.avatarId ?? null,
      aspectRatio: body.aspectRatio,
      voiceId: body.voiceId ?? null,
      voiceoverVolume: body.voiceoverVolume,
      backgroundMusicVolume: body.backgroundMusicVolume,
      targetDuration: body.targetDuration,
      scriptStyle: body.scriptStyle,
      scriptTone: body.scriptTone,
    };

    // Upsert the settings (insert if not exists, update if exists)
    await db
      .insert(settings)
      .values({
        key: SETTINGS_KEY,
        value: { ...defaults },
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: { ...defaults },
        },
      });

    return NextResponse.json(defaults);
  } catch (error) {
    console.error("Error saving video defaults:", error);
    return NextResponse.json(
      { error: "Failed to save video defaults" },
      { status: 500 }
    );
  }
}
