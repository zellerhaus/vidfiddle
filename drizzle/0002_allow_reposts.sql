-- A video could be posted to each platform only once, so reposts failed to save. Originals stay one per
-- video and platform; reposts are exempt.
ALTER TABLE "scheduled_posts" DROP CONSTRAINT IF EXISTS "scheduled_posts_video_id_platform_key";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_scheduled_posts_video_platform_original" ON "scheduled_posts" USING btree ("video_id","platform") WHERE "scheduled_posts"."is_repost" = false;
