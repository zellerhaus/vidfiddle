import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * Manual trigger for the check-creatify cron job.
 * Protected by session cookie middleware (no CRON_SECRET needed from the client).
 * Internally calls the cron endpoint with CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  // Determine the base URL from the incoming request
  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  try {
    const response = await fetch(`${baseUrl}/api/cron/check-creatify`, {
      method: "GET",
      headers: {
        "x-cron-secret": cronSecret,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[videos/check] Error:", error);
    return NextResponse.json(
      { error: "Failed to trigger video status check" },
      { status: 500 }
    );
  }
}
