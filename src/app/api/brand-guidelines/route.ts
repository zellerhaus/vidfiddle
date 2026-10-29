import { NextRequest, NextResponse } from "next/server";
import { asc, DrizzleQueryError } from "drizzle-orm";
import { PostgresError } from "postgres";
import { db } from "@/db";
import { brand_guidelines } from "@/db/schema";
import type { BrandGuidelineInsert } from "@/lib/supabase/types";

/**
 * GET /api/brand-guidelines
 * List all brand guidelines
 */
export async function GET() {
  try {
    let data;
    try {
      data = await db
        .select()
        .from(brand_guidelines)
        .orderBy(asc(brand_guidelines.name));
    } catch (error) {
      console.error("Error fetching brand guidelines:", error);
      return NextResponse.json(
        { error: "Failed to fetch brand guidelines" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in brand guidelines GET:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/brand-guidelines
 * Create a new brand guideline
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Prepare insert data
    const insertData: BrandGuidelineInsert = {
      name: body.name.trim(),
      is_default: body.is_default ?? false,
      voice_description: body.voice_description ?? null,
      target_audience: body.target_audience ?? null,
      terminology: body.terminology ?? [],
      tone_guidelines: body.tone_guidelines ?? null,
      content_restrictions: body.content_restrictions ?? null,
      example_phrases: body.example_phrases ?? [],
    };

    let data;
    try {
      [data] = await db
        .insert(brand_guidelines)
        .values(insertData)
        .returning();

      if (!data) {
        throw new Error("Failed to create brand guideline");
      }
    } catch (error) {
      // Check for unique constraint violation
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
      console.error("Error creating brand guideline:", error);
      return NextResponse.json(
        { error: "Failed to create brand guideline" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error in brand guidelines POST:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
