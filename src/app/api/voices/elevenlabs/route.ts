import { NextResponse } from "next/server";
import { listElevenLabsVoices, type ElevenLabsVoiceInfo } from "@/lib/video-engine/providers/elevenlabs";

// The voice list changes rarely; cache it briefly so opening the picker doesn't hit the API each time.
let cache: { at: number; voices: ElevenLabsVoiceInfo[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

function titleCase(value: string | null): string {
  return value ? value.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ElevenLabs is not configured. Add ELEVENLABS_API_KEY to .env." }, { status: 400 });
  }
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), voices: await listElevenLabsVoices(apiKey) };
    }
    // Shape matches the voice picker: grouped by accent, filtered by gender.
    return NextResponse.json(
      cache.voices.map((v) => ({
        id: v.id,
        // Many voice names already carry a description ("Adam - Dominant, Firm").
        name: v.description && !v.name.includes(" - ") ? `${v.name} · ${v.description}` : v.name,
        language: titleCase(v.accent) || "ElevenLabs",
        gender: titleCase(v.gender),
      }))
    );
  } catch (error) {
    console.error("Error fetching ElevenLabs voices:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch voices" }, { status: 500 });
  }
}
