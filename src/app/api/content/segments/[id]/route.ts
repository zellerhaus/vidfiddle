import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { content_segments } from "@/db/schema";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Update a segment
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content } = body;

    if (!title && !content) {
      return NextResponse.json(
        { error: "At least one of title or content is required" },
        { status: 400 }
      );
    }

    const updateData: { title?: string; content?: string } = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;

    let segment: typeof content_segments.$inferSelect | undefined;
    try {
      [segment] = await db
        .update(content_segments)
        .set(updateData)
        .where(eq(content_segments.id, id))
        .returning();

      if (!segment) throw new Error("Segment not found");
    } catch (error) {
      console.error("Error updating segment:", error);
      return NextResponse.json(
        { error: "Failed to update segment" },
        { status: 500 }
      );
    }

    return NextResponse.json({ segment });
  } catch (error) {
    console.error("Error in PATCH /api/content/segments/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Get a single segment
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    let segment: typeof content_segments.$inferSelect | undefined;
    try {
      [segment] = await db
        .select()
        .from(content_segments)
        .where(eq(content_segments.id, id))
        .limit(1);

      if (!segment) throw new Error("Segment not found");
    } catch (error) {
      console.error("Error fetching segment:", error);
      return NextResponse.json(
        { error: "Failed to fetch segment" },
        { status: 500 }
      );
    }

    if (!segment) {
      return NextResponse.json(
        { error: "Segment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ segment });
  } catch (error) {
    console.error("Error in GET /api/content/segments/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
