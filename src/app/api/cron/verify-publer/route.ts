import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduled_posts as scheduled_posts_table } from "@/db/schema";
import { getPublisher, NO_PUBLISHER_CONFIG_MESSAGE } from "@/lib/publishers";
import {
  startCronLog,
  completeCronLog,
  addError,
  incrementProcessed,
  setSummary,
} from "@/lib/cron-logger";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Cron endpoint to verify scheduled posts actually exist in the active publisher.
 * Runs every 10 minutes.
 *
 * 1. Checks posts with publer_post_id against the active publisher API
 * 2. Marks stale posts (no publer_post_id after 30 min) as failed
 */
export async function GET(request: NextRequest) {
  const logContext = await startCronLog("verify-publer");

  try {
    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret) {
      const authHeader = request.headers.get("authorization");
      const providedSecret = authHeader?.replace("Bearer ", "");
      if (providedSecret !== expectedSecret) {
        await completeCronLog(logContext, "error");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const publisher = getPublisher();
    if (!publisher) {
      setSummary(logContext, "skipped", NO_PUBLISHER_CONFIG_MESSAGE);
      await completeCronLog(logContext);
      return NextResponse.json({ message: NO_PUBLISHER_CONFIG_MESSAGE });
    }

    // 1. Check posts that have a publer_post_id and are still "scheduled"
    let postsWithId;
    try {
      postsWithId = await db
        .select()
        .from(scheduled_posts_table)
        .where(
          and(
            eq(scheduled_posts_table.status, "scheduled"),
            isNotNull(scheduled_posts_table.publer_post_id)
          )
        );
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Unknown database error";
      addError(logContext, `Failed to fetch posts: ${errorMessage}`);
      await completeCronLog(logContext);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    let verified = 0;
    let markedPosted = 0;
    let markedFailed = 0;

    for (const post of postsWithId) {
      try {
        const publerPostId = post.publer_post_id;
        if (!publerPostId) {
          continue;
        }

        const publisherPost = await publisher.getPost(publerPostId);

        if (!publisherPost) {
          // Post doesn't exist in the active publisher
          try {
            await db
              .update(scheduled_posts_table)
              .set({
                status: "failed",
                error_message: "Post not found in publisher",
              })
              .where(eq(scheduled_posts_table.id, post.id));
          } catch {
            // Preserve prior behavior: update failures were ignored
          }
          markedFailed++;
          console.log(`[VerifyPubler] Post ${post.id} not found in publisher, marked failed`);
        } else {
          const state = publisherPost.state.toLowerCase();

          if (state === "published" || state === "sent" || state === "success") {
            try {
              await db
                .update(scheduled_posts_table)
                .set({
                  status: "posted",
                  published_at: publisherPost.published_at || new Date().toISOString(),
                  platform_post_id: publisherPost.remote_post_id || publisherPost.id || null,
                  platform_post_url: publisherPost.post_link || null,
                })
                .where(eq(scheduled_posts_table.id, post.id));
            } catch {
              // Preserve prior behavior: update failures were ignored
            }
            markedPosted++;
            console.log(`[VerifyPubler] Post ${post.id} confirmed published`);
          } else if (state === "failed" || state === "error") {
            try {
              await db
                .update(scheduled_posts_table)
                .set({
                  status: "failed",
                  error_message: publisherPost.error || "Post failed in publisher",
                })
                .where(eq(scheduled_posts_table.id, post.id));
            } catch {
              // Preserve prior behavior: update failures were ignored
            }
            markedFailed++;
            console.log(`[VerifyPubler] Post ${post.id} failed in publisher: ${publisherPost.error}`);
          }
          // If still scheduled/queued, leave our record as-is
        }

        verified++;
        incrementProcessed(logContext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addError(logContext, `Error verifying post ${post.id}: ${msg}`);
      }
    }

    // 2. Mark stale posts (no publer_post_id, created > 30 min ago) as failed
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    let stalePosts: { id: string }[] | undefined;
    try {
      stalePosts = await db
        .select({ id: scheduled_posts_table.id })
        .from(scheduled_posts_table)
        .where(
          and(
            eq(scheduled_posts_table.status, "scheduled"),
            isNull(scheduled_posts_table.publer_post_id),
            lt(scheduled_posts_table.created_at, staleThreshold)
          )
        );
    } catch (staleError) {
      const errorMessage =
        staleError instanceof Error ? staleError.message : "Unknown database error";
      addError(logContext, `Failed to fetch stale posts: ${errorMessage}`);
    }

    if (stalePosts && stalePosts.length > 0) {
      const staleIds = stalePosts.map((p) => p.id);

      try {
        await db
          .update(scheduled_posts_table)
          .set({
            status: "failed",
          error_message: "Publisher post ID never captured - scheduling may have failed silently",
          })
          .where(inArray(scheduled_posts_table.id, staleIds));
      } catch {
        // Preserve prior behavior: update failures were ignored
      }

      markedFailed += staleIds.length;
      console.log(`[VerifyPubler] Marked ${staleIds.length} stale posts as failed`);
    }

    setSummary(logContext, "verified", verified);
    setSummary(logContext, "markedPosted", markedPosted);
    setSummary(logContext, "markedFailed", markedFailed);
    setSummary(logContext, "staleMarkedFailed", stalePosts?.length || 0);

    await completeCronLog(logContext);

    return NextResponse.json({
      success: true,
      verified,
      markedPosted,
      markedFailed,
      staleMarkedFailed: stalePosts?.length || 0,
    });
  } catch (error) {
    console.error("[VerifyPubler] Error:", error);
    addError(logContext, error instanceof Error ? error.message : String(error));
    await completeCronLog(logContext);
    return NextResponse.json(
      { error: "Failed to verify posts" },
      { status: 500 }
    );
  }
}
