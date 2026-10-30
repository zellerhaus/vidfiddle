import { NextResponse } from "next/server";
import { getAvatars, isCreatifyConfigured } from "@/lib/creatify";

export async function GET() {
  try {
    if (!isCreatifyConfigured()) {
      return NextResponse.json(
        { error: "Creatify is not configured. Add CREATIFY_API_ID and CREATIFY_API_KEY to .env" },
        { status: 400 }
      );
    }

    const avatars = await getAvatars();
    return NextResponse.json(avatars);
  } catch (error) {
    console.error("Error fetching Creatify avatars:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch avatars" },
      { status: 500 }
    );
  }
}
