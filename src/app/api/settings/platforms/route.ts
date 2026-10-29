import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { Platform } from "@/lib/supabase/types";

const SETTINGS_KEY = "default_platforms";

const VALID_PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "facebook",
];

const DEFAULT_PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
];

export async function GET() {
  try {
    const [data] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    const platforms = (data?.value as Platform[]) ?? DEFAULT_PLATFORMS;
    return NextResponse.json({ platforms });
  } catch (error) {
    console.error("Error fetching default platforms:", error);
    return NextResponse.json(
      { error: "Failed to fetch default platforms" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { platforms } = body as { platforms: Platform[] };

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { error: "At least one platform is required" },
        { status: 400 }
      );
    }

    // Validate all platforms
    for (const platform of platforms) {
      if (!VALID_PLATFORMS.includes(platform)) {
        return NextResponse.json(
          { error: `Invalid platform: ${platform}` },
          { status: 400 }
        );
      }
    }

    await db
      .insert(settings)
      .values({
        key: SETTINGS_KEY,
        value: platforms,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: platforms,
        },
      });

    return NextResponse.json({ platforms });
  } catch (error) {
    console.error("Error saving default platforms:", error);
    return NextResponse.json(
      { error: "Failed to save default platforms" },
      { status: 500 }
    );
  }
}
