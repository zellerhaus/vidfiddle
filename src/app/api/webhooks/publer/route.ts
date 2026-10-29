import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { publication_events, scheduled_posts } from "@/db/schema";
import type { Json, PublicationEventType } from "@/lib/supabase/types";
import crypto from "crypto";

// Publer webhook event types
interface PublerWebhookEvent {
  event: string;
  data: {
    id?: string;
    post_id?: string;
    status?: string;
    url?: string;
    platform_post_id?: string;
    platform_post_url?: string;
    error?: string;
    published_at?: string;
    [key: string]: Json | undefined;
  };
}

// Verify webhook signature if PUBLER_WEBHOOK_SECRET is configured
function verifySignature(
  payload: string,
  signature: string | null
): boolean {
  const secret = process.env.PUBLER_WEBHOOK_SECRET;

  // If no secret configured, skip verification (allow in dev mode)
  if (!secret) {
    console.log("[Publer Webhook] No webhook secret configured, skipping signature verification");
    return true;
  }

  // If secret configured but no signature provided, reject
  if (!signature) {
    console.error("[Publer Webhook] No signature provided but secret is configured");
    return false;
  }

  try {
    // Compute expected signature using HMAC-SHA256
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    // Compare signatures (constant-time comparison to prevent timing attacks)
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error("[Publer Webhook] Signature verification error:", error);
    return false;
  }
}

// Map Publer event to our publication event type
function mapEventType(publerEvent: string, status?: string): PublicationEventType | null {
  // Handle different Publer event formats
  switch (publerEvent.toLowerCase()) {
    case "post.published":
    case "post.success":
    case "published":
      return "published";
    case "post.scheduled":
    case "scheduled":
      return "scheduled";
    case "post.failed":
    case "post.error":
    case "failed":
      return "failed";
    case "post.deleted":
    case "post.removed":
    case "removed":
      return "removed";
    default:
      // Check status field if event type doesn't match
      if (status === "published" || status === "success") return "published";
      if (status === "scheduled") return "scheduled";
      if (status === "failed" || status === "error") return "failed";
      return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("x-publer-signature") ||
                      request.headers.get("x-webhook-signature");

    // Verify signature
    if (!verifySignature(rawBody, signature)) {
      console.error("[Publer Webhook] Invalid signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Parse the webhook payload
    let event: PublerWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      console.error("[Publer Webhook] Invalid JSON payload");
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    console.log("[Publer Webhook] Received event:", JSON.stringify(event, null, 2));

    // Get the post ID from various possible locations in the payload
    const postId = event.data?.post_id || event.data?.id;

    if (!postId) {
      console.log("[Publer Webhook] No post ID in event, acknowledging without processing");
      return NextResponse.json({ success: true, message: "No post ID to process" });
    }

    // Map the event type
    const eventType = mapEventType(event.event, event.data?.status);

    if (!eventType) {
      console.log("[Publer Webhook] Unknown event type:", event.event);
      return NextResponse.json({ success: true, message: "Unknown event type, ignored" });
    }

    // Find the scheduled_post by publer_post_id
    let scheduledPost;
    try {
      [scheduledPost] = await db
        .select()
        .from(scheduled_posts)
        .where(eq(scheduled_posts.publer_post_id, postId))
        .limit(1);
    } catch {
      scheduledPost = null;
    }

    // If not found by publer_post_id, the post might have been created before
    // the Publer job returned the post ID. Log and return success.
    if (!scheduledPost) {
      console.log(`[Publer Webhook] No scheduled_post found for publer_post_id: ${postId}`);
      return NextResponse.json({
        success: true,
        message: "No matching scheduled post found"
      });
    }

    const scheduledPostId = scheduledPost.id;

    // Build update data based on event type
    const updateData: Partial<typeof scheduled_posts.$inferInsert> = {};

    if (eventType === "published") {
      updateData.status = "posted";
      updateData.published_at = event.data?.published_at || new Date().toISOString();

      // Update platform post URL if provided
      if (event.data?.platform_post_url || event.data?.url) {
        updateData.platform_post_url = event.data.platform_post_url || event.data.url;
      }

      // Update platform post ID if provided
      if (event.data?.platform_post_id) {
        updateData.platform_post_id = event.data.platform_post_id;
      }
    } else if (eventType === "failed") {
      updateData.status = "failed";
      updateData.error_message = event.data?.error || "Publication failed";
    }

    // Update scheduled_post if there are changes
    if (Object.keys(updateData).length > 0) {
      let updateSucceeded = false;
      try {
        await db
          .update(scheduled_posts)
          .set(updateData)
          .where(eq(scheduled_posts.id, scheduledPostId));
        updateSucceeded = true;
      } catch (updateError) {
        console.error("[Publer Webhook] Error updating scheduled_post:", updateError);
        // Continue to create event record anyway
      }
      if (updateSucceeded) {
        console.log(`[Publer Webhook] Updated scheduled_post ${scheduledPostId}:`, updateData);
      }
    }

    // Create publication event record
    let eventCreated = false;
    try {
      await db.insert(publication_events).values({
        scheduled_post_id: scheduledPostId,
        event_type: eventType,
        event_data: {
          publer_event: event.event,
          publer_data: event.data,
          processed_at: new Date().toISOString(),
        },
      });
      eventCreated = true;
    } catch (eventError) {
      console.error("[Publer Webhook] Error creating publication_event:", eventError);
      // Don't fail the request - the main update succeeded
    }
    if (eventCreated) {
      console.log(`[Publer Webhook] Created publication_event for ${scheduledPostId}: ${eventType}`);
    }

    return NextResponse.json({
      success: true,
      scheduledPostId,
      eventType,
      updated: Object.keys(updateData).length > 0,
    });
  } catch (error) {
    console.error("[Publer Webhook] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}

// HEAD request support for webhook URL verification
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// GET request support for webhook URL verification (some services use GET to verify)
export async function GET() {
  return NextResponse.json({ status: "ok", message: "Publer webhook endpoint active" });
}
