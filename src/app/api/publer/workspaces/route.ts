import { NextResponse } from "next/server";
import { getWorkspaces } from "@/lib/publer";

export async function GET() {
  try {
    if (!process.env.PUBLER_API_KEY) {
      return NextResponse.json(
        { error: "PUBLER_API_KEY is not configured" },
        { status: 503 }
      );
    }

    const workspaces = await getWorkspaces();
    return NextResponse.json({ workspaces });
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    return NextResponse.json(
      { error: "Failed to fetch workspaces", details: String(error) },
      { status: 500 }
    );
  }
}
