import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CronExecutionStatus,
  CronType,
  Json,
  Platform,
} from "../lib/supabase/types";

const iso_timestamp_tz = customType<{
  data: string;
  driverData: string | Date;
}>({
  dataType() {
    return "timestamp with time zone";
  },
  fromDriver(value) {
    const dateValue = value instanceof Date ? value : new Date(value);
    return dateValue.toISOString();
  },
  toDriver(value) {
    return value;
  },
});

export const approval_status = pgEnum("approval_status", [
  "pending_review",
  "approved",
  "rejected",
  "needs_changes",
]);

export const content_status = pgEnum("content_status", [
  "new",
  "converting",
  "converted",
  "ignored",
]);

export const platform = pgEnum("platform", [
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "facebook",
]);

export const post_status = pgEnum("post_status", [
  "pending",
  "scheduled",
  "posted",
  "failed",
]);

export const queue_status = pgEnum("queue_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const video_status = pgEnum("video_status", [
  "pending",
  "generating",
  "completed",
  "failed",
]);

export const video_style = pgEnum("video_style", [
  "stock_footage",
  "ai_avatar",
  "text_on_screen",
]);

export const rss_feeds = pgTable(
  "rss_feeds",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    url: text().notNull(),
    title: text(),
    last_checked_at: iso_timestamp_tz("last_checked_at"),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
    auto_mode_enabled: boolean().default(false).notNull(),
    auto_videos_per_post: integer().default(1).notNull(),
    auto_platforms: jsonb().$type<Platform[]>().default(sql`'[]'::jsonb`).notNull(),
  },
  (table) => [
    unique("rss_feeds_url_key").on(table.url),
    check(
      "rss_feeds_auto_videos_per_post_check",
      sql`(${table.auto_videos_per_post} >= 1) AND (${table.auto_videos_per_post} <= 5)`
    ),
  ]
);

export const blog_posts = pgTable(
  "blog_posts",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    feed_id: uuid(),
    url: text().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    excerpt: text(),
    featured_image: text(),
    published_at: iso_timestamp_tz("published_at"),
    status: content_status().default("new").notNull(),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
    generated_script: text(),
    source_type: text().default("blog").notNull(),
  },
  (table) => [
    index("idx_blog_posts_created_at").on(table.created_at.desc()),
    index("idx_blog_posts_feed_id").on(table.feed_id),
    index("idx_blog_posts_status").on(table.status),
    foreignKey({
      columns: [table.feed_id],
      foreignColumns: [rss_feeds.id],
      name: "blog_posts_feed_id_fkey",
    }).onDelete("set null"),
    unique("blog_posts_url_key").on(table.url),
  ]
);

export const content_segments = pgTable(
  "content_segments",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    blog_post_id: uuid().notNull(),
    segment_index: integer().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    key_points: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    generated_script: text(),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
  },
  (table) => [
    index("idx_content_segments_blog_post_id").on(table.blog_post_id),
    foreignKey({
      columns: [table.blog_post_id],
      foreignColumns: [blog_posts.id],
      name: "content_segments_blog_post_id_fkey",
    }).onDelete("cascade"),
    unique("content_segments_blog_post_id_segment_index_key").on(
      table.blog_post_id,
      table.segment_index
    ),
  ]
);

export const videos = pgTable(
  "videos",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    blog_post_id: uuid().notNull(),
    script: text().notNull(),
    style: video_style().default("stock_footage").notNull(),
    style_options: jsonb().$type<Json | null>(),
    status: video_status().default("pending").notNull(),
    creatify_job_id: text(),
    video_url: text(),
    duration_seconds: integer(),
    error_message: text(),
    retry_count: integer().default(0).notNull(),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
    creatify_video_url: text(),
    generated_captions: jsonb().$type<Record<string, string> | null>(),
    content_segment_id: uuid(),
    approval_status: approval_status().default("pending_review").notNull(),
    rejection_reason: text(),
    regeneration_feedback: text(),
    auto_generated: boolean().default(false).notNull(),
    generation_attempt: integer().default(1).notNull(),
  },
  (table) => [
    uniqueIndex("idx_videos_active_dedup")
      .on(
        table.blog_post_id,
        sql`COALESCE(${table.content_segment_id}, '00000000-0000-0000-0000-000000000000'::uuid)`
      )
      .where(sql`${table.status} <> 'failed'::video_status`),
    index("idx_videos_blog_post_id").on(table.blog_post_id),
    index("idx_videos_content_segment_id").on(table.content_segment_id),
    index("idx_videos_created_at").on(table.created_at.desc()),
    index("idx_videos_status").on(table.status),
    foreignKey({
      columns: [table.blog_post_id],
      foreignColumns: [blog_posts.id],
      name: "videos_blog_post_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.content_segment_id],
      foreignColumns: [content_segments.id],
      name: "videos_content_segment_id_fkey",
    }).onDelete("set null"),
  ]
);

export const scheduled_posts = pgTable(
  "scheduled_posts",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    video_id: uuid().notNull(),
    platform: platform().notNull(),
    caption: text().notNull(),
    scheduled_at: iso_timestamp_tz("scheduled_at"),
    publer_post_id: text(),
    status: post_status().default("pending").notNull(),
    error_message: text(),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
    published_at: iso_timestamp_tz("published_at"),
    platform_post_id: text(),
    platform_post_url: text(),
    is_repost: boolean().default(false).notNull(),
    original_post_id: uuid(),
  },
  (table) => [
    index("idx_scheduled_posts_original_post_id")
      .on(table.original_post_id)
      .where(sql`${table.original_post_id} IS NOT NULL`),
    index("idx_scheduled_posts_published_at")
      .on(table.published_at)
      .where(sql`${table.published_at} IS NOT NULL`),
    index("idx_scheduled_posts_scheduled_at").on(table.scheduled_at),
    index("idx_scheduled_posts_status").on(table.status),
    index("idx_scheduled_posts_video_id").on(table.video_id),
    foreignKey({
      columns: [table.video_id],
      foreignColumns: [videos.id],
      name: "scheduled_posts_video_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.original_post_id],
      foreignColumns: [table.id],
      name: "scheduled_posts_original_post_id_fkey",
    }).onDelete("set null"),
    unique("scheduled_posts_video_id_platform_key").on(
      table.video_id,
      table.platform
    ),
  ]
);

export const settings = pgTable(
  "settings",
  {
    id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
    key: text().notNull(),
    value: jsonb().$type<Json>().notNull(),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
  },
  (table) => [unique("settings_key_key").on(table.key)]
);

export const generation_queue = pgTable(
  "generation_queue",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    blog_post_id: uuid().notNull(),
    segment_id: uuid(),
    status: queue_status().default("pending").notNull(),
    priority: integer().default(0).notNull(),
    attempts: integer().default(0).notNull(),
    max_attempts: integer().default(3).notNull(),
    error_message: text(),
    scheduled_for: iso_timestamp_tz("scheduled_for").default(sql`now()`).notNull(),
    started_at: iso_timestamp_tz("started_at"),
    completed_at: iso_timestamp_tz("completed_at"),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
    updated_at: iso_timestamp_tz("updated_at").default(sql`now()`).notNull(),
  },
  (table) => [
    index("idx_generation_queue_pending")
      .on(table.status, table.scheduled_for)
      .where(sql`${table.status} = 'pending'::queue_status`),
    index("idx_generation_queue_scheduled_for").on(table.scheduled_for),
    index("idx_generation_queue_status").on(table.status),
    foreignKey({
      columns: [table.blog_post_id],
      foreignColumns: [blog_posts.id],
      name: "generation_queue_blog_post_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.segment_id],
      foreignColumns: [content_segments.id],
      name: "generation_queue_segment_id_fkey",
    }).onDelete("cascade"),
  ]
);

export const publication_events = pgTable(
  "publication_events",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    scheduled_post_id: uuid().notNull(),
    event_type: text().$type<
      "scheduled" | "published" | "failed" | "removed"
    >().notNull(),
    event_data: jsonb().$type<Json>().default(sql`'{}'::jsonb`),
    created_at: iso_timestamp_tz("created_at").default(sql`now()`).notNull(),
  },
  (table) => [
    index("idx_publication_events_created_at").on(table.created_at),
    index("idx_publication_events_event_type").on(table.event_type),
    index("idx_publication_events_scheduled_post_id").on(
      table.scheduled_post_id
    ),
    foreignKey({
      columns: [table.scheduled_post_id],
      foreignColumns: [scheduled_posts.id],
      name: "publication_events_scheduled_post_id_fkey",
    }).onDelete("cascade"),
    check(
      "publication_events_event_type_check",
      sql`${table.event_type} = ANY (ARRAY['scheduled'::text, 'published'::text, 'failed'::text, 'removed'::text])`
    ),
  ]
);

export const brand_guidelines = pgTable(
  "brand_guidelines",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    is_default: boolean().$type<boolean>().default(false),
    voice_description: text(),
    target_audience: text(),
    terminology: jsonb().$type<string[]>().default(sql`'[]'::jsonb`),
    tone_guidelines: text(),
    content_restrictions: text(),
    example_phrases: jsonb().$type<string[]>().default(sql`'[]'::jsonb`),
    created_at: iso_timestamp_tz("created_at").$type<string>().default(sql`now()`),
    updated_at: iso_timestamp_tz("updated_at").$type<string>().default(sql`now()`),
  },
  (table) => [
    index("idx_brand_guidelines_is_default")
      .on(table.is_default)
      .where(sql`${table.is_default} = true`),
    unique("brand_guidelines_name_key").on(table.name),
    pgPolicy("Service role can manage brand_guidelines", {
      as: "permissive",
      for: "all",
      to: ["public"],
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ]
).enableRLS();

export const cron_logs = pgTable(
  "cron_logs",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    cron_type: text().$type<CronType>().notNull(),
    started_at: iso_timestamp_tz("started_at").default(sql`now()`).notNull(),
    completed_at: iso_timestamp_tz("completed_at"),
    status: text().$type<CronExecutionStatus>().default("success").notNull(),
    items_processed: integer().$type<number>().default(0),
    items_failed: integer().$type<number>().default(0),
    errors: jsonb().$type<string[]>().default(sql`'[]'::jsonb`),
    summary: jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    created_at: iso_timestamp_tz("created_at").$type<string>().default(sql`now()`),
  },
  (table) => [
    index("idx_cron_logs_cron_type").on(table.cron_type),
    index("idx_cron_logs_started_at").on(table.started_at.desc()),
    index("idx_cron_logs_status").on(table.status),
    check(
      "cron_logs_status_check",
      sql`${table.status} = ANY (ARRAY['success'::text, 'error'::text, 'partial'::text])`
    ),
  ]
);
