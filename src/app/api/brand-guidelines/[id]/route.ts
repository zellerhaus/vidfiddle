import { NextRequest, NextResponse } from "next/server";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { PostgresError } from "postgres";
import { db } from "@/db";
import { brand_guidelines } from "@/db/schema";
import type { BrandGuidelineUpdate } from "@/lib/supabase/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/brand-guidelines/[id]
 * Get a single brand guideline by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    let data;
    try {
      [data] = await db
        .select()
        .from(brand_guidelines)
        .where(eq(brand_guidelines.id, id))
        .limit(1);
    } catch (error) {
      console.error("Error fetching brand guideline:", error);
      return NextResponse.json(
        { error: "Failed to fetch brand guideline" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Brand guideline not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in brand guideline GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/brand-guidelines/[id]
 * Update a brand guideline
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Prepare update data - only include fields that are present
    const updateData: BrandGuidelineUpdate = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return NextResponse.json(
          { error: "Name cannot be empty" },
          { status: 400 }
        );
      }
      updateData.name = body.name.trim();
    }

    if (body.is_default !== undefined) {
      updateData.is_default = body.is_default;
    }

    if (body.voice_description !== undefined) {
      updateData.voice_description = body.voice_description;
    }

    if (body.target_audience !== undefined) {
      updateData.target_audience = body.target_audience;
    }

    if (body.terminology !== undefined) {
      updateData.terminology = body.terminology;
    }

    if (body.tone_guidelines !== undefined) {
      updateData.tone_guidelines = body.tone_guidelines;
    }

    if (body.content_restrictions !== undefined) {
      updateData.content_restrictions = body.content_restrictions;
    }

    if (body.example_phrases !== undefined) {
      updateData.example_phrases = body.example_phrases;
    }

    let data;
    try {
      if (Object.keys(updateData).length > 0) {
        [data] = await db
          .update(brand_guidelines)
          .set(updateData)
          .where(eq(brand_guidelines.id, id))
          .returning();
      }
    } catch (error) {
      if (
        error instanceof DrizzleQueryError &&
        error.cause instanceof PostgresError &&
        error.cause.code === "23505"
      ) {
        return NextResponse.json(
          { error: "A brand guideline with this name already exists" },
          { status: 409 }
        );
      }
      console.error("Error updating brand guideline:", error);
      return NextResponse.json(
        { error: "Failed to update brand guideline" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Brand guideline not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in brand guideline PUT:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/brand-guidelines/[id]
 * Delete a brand guideline
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    try {
      await db
        .delete(brand_guidelines)
        .where(eq(brand_guidelines.id, id));
    } catch (error) {
      console.error("Error deleting brand guideline:", error);
      return NextResponse.json(
        { error: "Failed to delete brand guideline" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in brand guideline DELETE:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
