import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rss_feeds } from "@/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const [feed] = await db
      .select()
      .from(rss_feeds)
      .where(eq(rss_feeds.id, id))
      .limit(1)
      .catch(() => []);

    if (!feed) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    return NextResponse.json(feed);
  } catch (error) {
    console.error("Error fetching feed:", error);
    return NextResponse.json(
      { error: "Failed to fetch feed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await db.delete(rss_feeds).where(eq(rss_feeds.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting feed:", error);
    return NextResponse.json(
      { error: "Failed to delete feed" },
      { status: 500 }
    );
  }
}
