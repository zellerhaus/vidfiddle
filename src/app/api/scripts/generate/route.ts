import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, brand_guidelines, content_segments } from "@/db/schema";
import { generateScript, isClaudeConfigured, parseBrandGuideline } from "@/lib/claude";
import type { BrandGuideline } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  try {
    const { blogPostId, segmentId, targetDuration, style, tone, regenerate, brandGuidelineId } = await request.json();

    if (!blogPostId) {
      return NextResponse.json(
        { error: "Blog post ID is required" },
        { status: 400 }
      );
    }

    // Fetch the blog post
    const [post] = await db
      .select()
      .from(blog_posts)
      .where(eq(blog_posts.id, blogPostId))
      .limit(1)
      .catch(() => []);

    if (!post) {
      return NextResponse.json(
        { error: "Blog post not found" },
        { status: 404 }
      );
    }

    // If segmentId is provided, fetch the segment
    let segment = null;
    if (segmentId) {
      const [segmentData] = await db
        .select()
        .from(content_segments)
        .where(eq(content_segments.id, segmentId))
        .limit(1)
        .catch(() => []);

      if (!segmentData) {
        return NextResponse.json(
          { error: "Segment not found" },
          { status: 404 }
        );
      }
      segment = segmentData;
    }

    // Determine content source - use segment if provided, otherwise use post
    const contentTitle = segment ? segment.title : post.title;
    const contentBody = segment ? segment.content : post.content;
    const existingScript = segment ? segment.generated_script : post.generated_script;

    // Return existing script if available (unless regenerate is requested)
    if (existingScript && !regenerate) {
      const words = existingScript.trim().split(/\s+/).length;
      const estimatedDuration = Math.round((words / 150) * 60);
      return NextResponse.json({
        script: existingScript,
        estimatedDuration,
        wordCount: words,
        fromCache: true,
      });
    }

    // Check Claude is configured before generating new script
    if (!isClaudeConfigured()) {
      return NextResponse.json(
        { error: "Claude API is not configured" },
        { status: 503 }
      );
    }

    // Fetch brand guideline if provided
    let brandGuideline = null;
    if (brandGuidelineId) {
      const [brandData] = await db
        .select()
        .from(brand_guidelines)
        .where(eq(brand_guidelines.id, brandGuidelineId))
        .limit(1)
        .catch(() => []);

      if (brandData) {
        brandGuideline = parseBrandGuideline(brandData as BrandGuideline);
      }
    }

    // Generate the script using Claude
    const result = await generateScript({
      title: contentTitle,
      content: contentBody,
      targetDuration: targetDuration || 45,
      style: style || "informative",
      tone: tone || "casual",
      brandGuideline,
    });

    // Save the generated script to the appropriate table
    if (segment) {
      // Save to content_segments table
      try {
        await db
          .update(content_segments)
          .set({ generated_script: result.script })
          .where(eq(content_segments.id, segmentId));
      } catch (updateError) {
        console.error("Failed to save generated script to segment:", updateError);
      }
    } else {
      // Save to blog_posts table
      try {
        await db
          .update(blog_posts)
          .set({ generated_script: result.script })
          .where(eq(blog_posts.id, blogPostId));
      } catch (updateError) {
        console.error("Failed to save generated script:", updateError);
      }
    }

    return NextResponse.json({
      script: result.script,
      estimatedDuration: result.estimatedDuration,
      wordCount: result.wordCount,
      hooks: result.hooks,
      fromCache: false,
    });
  } catch (error) {
    console.error("Error generating script:", error);
    return NextResponse.json(
      { error: "Failed to generate script" },
      { status: 500 }
    );
  }
}
