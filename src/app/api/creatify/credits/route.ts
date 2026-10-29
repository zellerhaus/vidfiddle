import { NextResponse } from "next/server";
import { getRemainingCredits, isCreatifyConfigured } from "@/lib/creatify";

export async function GET() {
  try {
    if (!isCreatifyConfigured()) {
      return NextResponse.json(
        { error: "Creatify is not configured. Add CREATIFY_API_ID and CREATIFY_API_KEY to .env.local" },
        { status: 400 }
      );
    }

    const credits = await getRemainingCredits();
    return NextResponse.json(credits);
  } catch (error) {
    console.error("Error fetching Creatify credits:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch credits" },
      { status: 500 }
    );
  }
}
