CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending_review', 'approved', 'rejected', 'needs_changes');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('new', 'converting', 'converted', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'tiktok', 'youtube', 'linkedin', 'twitter', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('pending', 'scheduled', 'posted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('pending', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_style" AS ENUM('stock_footage', 'ai_avatar', 'text_on_screen');--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"feed_id" uuid,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text,
	"featured_image" text,
	"published_at" timestamp with time zone,
	"status" "content_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_script" text,
	"source_type" text DEFAULT 'blog' NOT NULL,
	CONSTRAINT "blog_posts_url_key" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "brand_guidelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false,
	"voice_description" text,
	"target_audience" text,
	"terminology" jsonb DEFAULT '[]'::jsonb,
	"tone_guidelines" text,
	"content_restrictions" text,
	"example_phrases" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "brand_guidelines_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "brand_guidelines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_segments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"blog_post_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_script" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_segments_blog_post_id_segment_index_key" UNIQUE("blog_post_id","segment_index")
);
--> statement-breakpoint
CREATE TABLE "cron_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cron_type" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'success' NOT NULL,
	"items_processed" integer DEFAULT 0,
	"items_failed" integer DEFAULT 0,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"summary" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cron_logs_status_check" CHECK ("cron_logs"."status" = ANY (ARRAY['success'::text, 'error'::text, 'partial'::text]))
);
--> statement-breakpoint
CREATE TABLE "generation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_post_id" uuid NOT NULL,
	"segment_id" uuid,
	"status" "queue_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_message" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_post_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_events_event_type_check" CHECK ("publication_events"."event_type" = ANY (ARRAY['scheduled'::text, 'published'::text, 'failed'::text, 'removed'::text]))
);
--> statement-breakpoint
CREATE TABLE "rss_feeds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auto_mode_enabled" boolean DEFAULT false NOT NULL,
	"auto_videos_per_post" integer DEFAULT 1 NOT NULL,
	"auto_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "rss_feeds_url_key" UNIQUE("url"),
	CONSTRAINT "rss_feeds_auto_videos_per_post_check" CHECK (("rss_feeds"."auto_videos_per_post" >= 1) AND ("rss_feeds"."auto_videos_per_post" <= 5))
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"video_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"caption" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"publer_post_id" text,
	"status" "post_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"platform_post_id" text,
	"platform_post_url" text,
	"is_repost" boolean DEFAULT false NOT NULL,
	"original_post_id" uuid,
	CONSTRAINT "scheduled_posts_video_id_platform_key" UNIQUE("video_id","platform")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"blog_post_id" uuid NOT NULL,
	"script" text NOT NULL,
	"style" "video_style" DEFAULT 'stock_footage' NOT NULL,
	"style_options" jsonb,
	"status" "video_status" DEFAULT 'pending' NOT NULL,
	"creatify_job_id" text,
	"video_url" text,
	"duration_seconds" integer,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"creatify_video_url" text,
	"generated_captions" jsonb,
	"content_segment_id" uuid,
	"approval_status" "approval_status" DEFAULT 'pending_review' NOT NULL,
	"rejection_reason" text,
	"regeneration_feedback" text,
	"auto_generated" boolean DEFAULT false NOT NULL,
	"generation_attempt" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_clips" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"youtube_source_id" uuid NOT NULL,
	"blog_post_id" uuid,
	"video_id" uuid,
	"clip_index" integer NOT NULL,
	"title" text NOT NULL,
	"start_time" double precision NOT NULL,
	"end_time" double precision NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"viral_score" double precision,
	"hook_reason" text,
	"transcript_words" jsonb,
	"raw_clip_url" text,
	"captioned_clip_url" text,
	"creatomate_render_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"youtube_url" text NOT NULL,
	"youtube_video_id" text NOT NULL,
	"title" text,
	"channel_name" text,
	"duration_seconds" integer,
	"source_video_url" text,
	"transcript" jsonb,
	"caption_style" jsonb,
	"clip_preferences" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submagic_project_id" text
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "public"."rss_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_segments" ADD CONSTRAINT "content_segments_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_queue" ADD CONSTRAINT "generation_queue_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_queue" ADD CONSTRAINT "generation_queue_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."content_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_events" ADD CONSTRAINT "publication_events_scheduled_post_id_fkey" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_original_post_id_fkey" FOREIGN KEY ("original_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_content_segment_id_fkey" FOREIGN KEY ("content_segment_id") REFERENCES "public"."content_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_clips" ADD CONSTRAINT "youtube_clips_youtube_source_id_fkey" FOREIGN KEY ("youtube_source_id") REFERENCES "public"."youtube_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_clips" ADD CONSTRAINT "youtube_clips_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_clips" ADD CONSTRAINT "youtube_clips_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blog_posts_created_at" ON "blog_posts" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_blog_posts_feed_id" ON "blog_posts" USING btree ("feed_id");--> statement-breakpoint
CREATE INDEX "idx_blog_posts_status" ON "blog_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_brand_guidelines_is_default" ON "brand_guidelines" USING btree ("is_default") WHERE "brand_guidelines"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_content_segments_blog_post_id" ON "content_segments" USING btree ("blog_post_id");--> statement-breakpoint
CREATE INDEX "idx_cron_logs_cron_type" ON "cron_logs" USING btree ("cron_type");--> statement-breakpoint
CREATE INDEX "idx_cron_logs_started_at" ON "cron_logs" USING btree ("started_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_cron_logs_status" ON "cron_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_generation_queue_pending" ON "generation_queue" USING btree ("status","scheduled_for") WHERE "generation_queue"."status" = 'pending'::queue_status;--> statement-breakpoint
CREATE INDEX "idx_generation_queue_scheduled_for" ON "generation_queue" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_generation_queue_status" ON "generation_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_publication_events_created_at" ON "publication_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_publication_events_event_type" ON "publication_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_publication_events_scheduled_post_id" ON "publication_events" USING btree ("scheduled_post_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_original_post_id" ON "scheduled_posts" USING btree ("original_post_id") WHERE "scheduled_posts"."original_post_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_published_at" ON "scheduled_posts" USING btree ("published_at") WHERE "scheduled_posts"."published_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_scheduled_at" ON "scheduled_posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_status" ON "scheduled_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_video_id" ON "scheduled_posts" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_videos_active_dedup" ON "videos" USING btree ("blog_post_id",COALESCE("content_segment_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "videos"."status" <> 'failed'::video_status;--> statement-breakpoint
CREATE INDEX "idx_videos_blog_post_id" ON "videos" USING btree ("blog_post_id");--> statement-breakpoint
CREATE INDEX "idx_videos_content_segment_id" ON "videos" USING btree ("content_segment_id");--> statement-breakpoint
CREATE INDEX "idx_videos_created_at" ON "videos" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_videos_status" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_youtube_clips_source_id" ON "youtube_clips" USING btree ("youtube_source_id");--> statement-breakpoint
CREATE INDEX "idx_youtube_clips_status" ON "youtube_clips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_youtube_clips_video_id" ON "youtube_clips" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_youtube_sources_status" ON "youtube_sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_youtube_sources_youtube_video_id" ON "youtube_sources" USING btree ("youtube_video_id");--> statement-breakpoint
CREATE POLICY "Service role can manage brand_guidelines" ON "brand_guidelines" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
--> statement-breakpoint
COMMENT ON TABLE "brand_guidelines" IS 'Stores brand voice guidelines for script generation';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."name" IS 'Unique name for this brand guideline set';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."is_default" IS 'Whether this is the default guideline to use';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."voice_description" IS 'Description of the brand voice and personality';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."target_audience" IS 'Description of the target audience';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."terminology" IS 'JSON array of key terms and phrases to use';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."tone_guidelines" IS 'Guidelines for tone and style';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."content_restrictions" IS 'Topics or language to avoid';--> statement-breakpoint
COMMENT ON COLUMN "brand_guidelines"."example_phrases" IS 'JSON array of example phrases that exemplify the brand voice';--> statement-breakpoint
COMMENT ON TABLE "cron_logs" IS 'Tracks execution history of cron jobs for debugging and monitoring';--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ensure_single_default_brand_guideline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If setting this row as default, unset all other defaults
  IF NEW.is_default = true THEN
    UPDATE brand_guidelines
    SET is_default = false
    WHERE id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enforce_single_default_brand_guideline BEFORE INSERT OR UPDATE ON "brand_guidelines" FOR EACH ROW WHEN ((new.is_default = true)) EXECUTE FUNCTION public.ensure_single_default_brand_guideline();--> statement-breakpoint
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON "blog_posts" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_brand_guidelines_updated_at BEFORE UPDATE ON "brand_guidelines" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_content_segments_updated_at BEFORE UPDATE ON "content_segments" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_generation_queue_updated_at BEFORE UPDATE ON "generation_queue" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_rss_feeds_updated_at BEFORE UPDATE ON "rss_feeds" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_scheduled_posts_updated_at BEFORE UPDATE ON "scheduled_posts" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON "settings" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON "videos" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_youtube_clips_updated_at BEFORE UPDATE ON "youtube_clips" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();--> statement-breakpoint
CREATE TRIGGER update_youtube_sources_updated_at BEFORE UPDATE ON "youtube_sources" FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
