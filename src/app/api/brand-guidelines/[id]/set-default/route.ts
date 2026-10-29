import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brand_guidelines } from "@/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/brand-guidelines/[id]/set-default
 * Set a brand guideline as the default
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Check if the guideline exists
    const [existing] = await db
      .select({ id: brand_guidelines.id })
      .from(brand_guidelines)
      .where(eq(brand_guidelines.id, id))
      .limit(1)
      .catch(() => []);

    if (!existing) {
      return NextResponse.json(
        { error: "Brand guideline not found" },
        { status: 404 }
      );
    }

    // Set this one as default (the trigger will unset others)
    let data;
    try {
      [data] = await db
        .update(brand_guidelines)
        .set({ is_default: true })
        .where(eq(brand_guidelines.id, id))
        .returning();

      if (!data) {
        throw new Error("Brand guideline not found");
      }
    } catch (error) {
      console.error("Error setting default brand guideline:", error);
      return NextResponse.json(
        { error: "Failed to set default brand guideline" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in set-default POST:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
