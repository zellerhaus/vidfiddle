import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

export async function GET() {
  try {
    const count = await db.$count(videos, and(
      eq(videos.auto_generated, true),
      eq(videos.approval_status, "pending_review")
    ));

    return NextResponse.json({ count: count || 0 });
  } catch (error) {
    console.error("Error fetching pending count:", error);
    return NextResponse.json({ count: 0 });
  }
}
