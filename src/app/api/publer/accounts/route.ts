import { NextResponse } from "next/server";
import { getAccounts, isPublerConfigured } from "@/lib/publer";

export async function GET() {
  try {
    if (!isPublerConfigured()) {
      return NextResponse.json(
        { error: "Publer is not configured. Add PUBLER_API_KEY and PUBLER_WORKSPACE_ID to .env" },
        { status: 400 }
      );
    }

    const accounts = await getAccounts();
    return NextResponse.json(accounts);
  } catch (error) {
    console.error("Error fetching Publer accounts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}
