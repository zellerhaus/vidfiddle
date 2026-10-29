import { NextResponse } from "next/server";
import { getVoices, isCreatifyConfigured } from "@/lib/creatify";

export async function GET() {
  try {
    if (!isCreatifyConfigured()) {
      return NextResponse.json(
        { error: "Creatify is not configured. Add CREATIFY_API_ID and CREATIFY_API_KEY to .env.local" },
        { status: 400 }
      );
    }

    const voices = await getVoices();
    return NextResponse.json(voices);
  } catch (error) {
    console.error("Error fetching Creatify voices:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch voices" },
      { status: 500 }
    );
  }
}
