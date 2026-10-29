import { NextRequest, NextResponse } from "next/server";
import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { blog_posts, rss_feeds } from "@/db/schema";
import { extractContent } from "@/lib/content-extractor";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = db
      .select({ ...getTableColumns(blog_posts), rss_feeds })
      .from(blog_posts)
      .leftJoin(rss_feeds, eq(blog_posts.feed_id, rss_feeds.id))
      .orderBy(desc(blog_posts.created_at))
      .$dynamic();

    if (status) {
      query = query.where(eq(blog_posts.status, sql`${status}`));
    }

    const posts = await query;

    return NextResponse.json(posts);
  } catch (error) {
    console.error("Error fetching content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Blog URL is required" },
        { status: 400 }
      );
    }

    // Check if already exists
    const [existing] = await db
      .select({ id: blog_posts.id })
      .from(blog_posts)
      .where(eq(blog_posts.url, url))
      .limit(1)
      .catch(() => []);

    if (existing) {
      return NextResponse.json(
        { error: "This URL has already been added" },
        { status: 409 }
      );
    }

    // Extract content from the URL
    let extracted;
    try {
      extracted = await extractContent(url);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to extract content from URL",
        },
        { status: 400 }
      );
    }

    // Insert the blog post
    const [post] = await db
      .insert(blog_posts)
      .values({
        url,
        title: extracted.title,
        content: extracted.content,
        excerpt: extracted.excerpt,
        featured_image: extracted.featuredImage,
        published_at: extracted.publishedAt,
        status: "new",
      })
      .returning();

    if (!post) throw new Error("Failed to add content");

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    console.error("Error adding content:", error);
    return NextResponse.json(
      { error: "Failed to add content" },
      { status: 500 }
    );
  }
}
