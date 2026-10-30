import {
  blog_posts,
  brand_guidelines,
  content_segments,
  cron_logs,
  generation_queue,
  publication_events,
  rss_feeds,
  scheduled_posts,
  settings,
  videos,
  youtube_clips,
  youtube_sources,
} from "@/db/schema";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type VideoStyle = "stock_footage" | "ai_avatar" | "text_on_screen";
export type VideoStatus = "pending" | "generating" | "completed" | "failed";
export type PostStatus = "pending" | "scheduled" | "posted" | "failed";
export type ContentStatus = "new" | "converting" | "converted" | "ignored";
export type Platform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitter"
  | "facebook";
export type ApprovalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "needs_changes";
export type QueueStatus = "pending" | "processing" | "completed" | "failed";
// "local" renders on this machine with the OpenAI engine (src/lib/local-engine.ts).
export type CreatifyApiMethod = "ai_shorts" | "link_to_video" | "lipsync_v2" | "local";
export type PublicationEventType =
  | "scheduled"
  | "published"
  | "failed"
  | "removed";
export type CronType =
  | "check-feeds"
  | "process-queue"
  | "check-creatify"
  | "check-youtube"
  | "verify-publer";
export type CronExecutionStatus = "success" | "error" | "partial";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface ViralMoment {
  startTime: number;
  endTime: number;
  title: string;
  hookReason: string;
  viralScore: number;
  words: WordTimestamp[];
}

export interface CaptionStylePreset {
  id: string;
  name: string;
  templateId?: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textColor: string;
  activeWordColor: string;
  strokeColor: string;
  strokeWidth: number;
  position: "center" | "bottom" | "top";
  animation: "pop" | "bounce" | "fade" | "none";
  wordsPerGroup: number;
}

export interface YouTubeClipPreferences {
  targetDuration: number;
  maxClips: number;
}

type RssFeedRow = typeof rss_feeds.$inferSelect;
type RssFeedInsertRow = typeof rss_feeds.$inferInsert;
type BlogPostRow = typeof blog_posts.$inferSelect;
type BlogPostInsertRow = typeof blog_posts.$inferInsert;
type VideoRow = typeof videos.$inferSelect;
type VideoInsertRow = typeof videos.$inferInsert;
type ContentSegmentRow = typeof content_segments.$inferSelect;
type ContentSegmentInsertRow = typeof content_segments.$inferInsert;
type ScheduledPostRow = typeof scheduled_posts.$inferSelect;
type ScheduledPostInsertRow = typeof scheduled_posts.$inferInsert;
type SettingRow = typeof settings.$inferSelect;
type SettingInsertRow = typeof settings.$inferInsert;
type GenerationQueueRow = typeof generation_queue.$inferSelect;
type GenerationQueueInsertRow = typeof generation_queue.$inferInsert;
type PublicationEventRow = typeof publication_events.$inferSelect;
type PublicationEventInsertRow = typeof publication_events.$inferInsert;
type YouTubeSourceRow = typeof youtube_sources.$inferSelect;
type YouTubeSourceInsertRow = typeof youtube_sources.$inferInsert;
type YouTubeClipRow = typeof youtube_clips.$inferSelect;
type YouTubeClipInsertRow = typeof youtube_clips.$inferInsert;
type BrandGuidelineRowRaw = typeof brand_guidelines.$inferSelect;
type BrandGuidelineRow = Omit<
  BrandGuidelineRowRaw,
  "is_default" | "terminology" | "example_phrases" | "created_at" | "updated_at"
> & {
  is_default: boolean;
  terminology: Json;
  example_phrases: Json;
  created_at: string;
  updated_at: string;
};
type BrandGuidelineInsertRow = typeof brand_guidelines.$inferInsert;

export interface Database {
  public: {
    Tables: {
      rss_feeds: {
        Row: RssFeedRow;
        Insert: RssFeedInsertRow;
        Update: Partial<RssFeedInsertRow>;
      };
      blog_posts: {
        Row: BlogPostRow;
        Insert: BlogPostInsertRow;
        Update: Partial<BlogPostInsertRow>;
      };
      videos: {
        Row: VideoRow;
        Insert: VideoInsertRow;
        Update: Partial<VideoInsertRow>;
      };
      content_segments: {
        Row: ContentSegmentRow;
        Insert: ContentSegmentInsertRow;
        Update: Partial<ContentSegmentInsertRow>;
      };
      scheduled_posts: {
        Row: ScheduledPostRow;
        Insert: ScheduledPostInsertRow;
        Update: Partial<ScheduledPostInsertRow>;
      };
      settings: {
        Row: SettingRow;
        Insert: SettingInsertRow;
        Update: Partial<SettingInsertRow>;
      };
      generation_queue: {
        Row: GenerationQueueRow;
        Insert: GenerationQueueInsertRow;
        Update: Partial<GenerationQueueInsertRow>;
      };
      publication_events: {
        Row: PublicationEventRow;
        Insert: PublicationEventInsertRow;
        Update: Partial<PublicationEventInsertRow>;
      };
      youtube_sources: {
        Row: YouTubeSourceRow;
        Insert: YouTubeSourceInsertRow;
        Update: Partial<YouTubeSourceInsertRow>;
      };
      youtube_clips: {
        Row: YouTubeClipRow;
        Insert: YouTubeClipInsertRow;
        Update: Partial<YouTubeClipInsertRow>;
      };
      brand_guidelines: {
        Row: BrandGuidelineRow;
        Insert: BrandGuidelineInsertRow;
        Update: Partial<BrandGuidelineInsertRow>;
      };
      cron_logs: {
        Row: typeof cron_logs.$inferSelect;
        Insert: typeof cron_logs.$inferInsert;
        Update: Partial<typeof cron_logs.$inferInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      video_style: VideoStyle;
      video_status: VideoStatus;
      post_status: PostStatus;
      content_status: ContentStatus;
      platform: Platform;
      approval_status: ApprovalStatus;
      queue_status: QueueStatus;
      publication_event_type: PublicationEventType;
    };
  };
}

export type RssFeed = RssFeedRow;
export type BlogPost = BlogPostRow;
export type Video = VideoRow;
export type ScheduledPost = ScheduledPostRow;
export type Setting = SettingRow;

export type RssFeedInsert = RssFeedInsertRow;
export type BlogPostInsert = BlogPostInsertRow;
export type VideoInsert = VideoInsertRow;
export type ScheduledPostInsert = ScheduledPostInsertRow;

export type BlogPostWithFeed = BlogPost & {
  rss_feeds: RssFeed | null;
};

export type VideoWithPost = Video & {
  blog_posts: BlogPost;
};

export type VideoWithPostAndScheduled = Video & {
  blog_posts: BlogPost;
  scheduled_posts: ScheduledPost[];
};

export interface VideoDefaults {
  apiMethod: CreatifyApiMethod;
  creatifyStyle: string;
  visualStyle?: string;
  videoLength?: number;
  avatarId?: string | null;
  aspectRatio: "9:16" | "16:9" | "1:1";
  voiceId: string | null;
  voiceoverVolume: number;
  backgroundMusicVolume: number;
  targetDuration: number;
  scriptStyle: string;
  scriptTone: string;
  /** Local engine: slow | medium | fast. */
  pacing?: string;
  /** Local engine: auto, a mood, or none. */
  musicMood?: string;
}

export type ContentSegment = ContentSegmentRow;
export type ContentSegmentInsert = ContentSegmentInsertRow;

export interface SegmentationParams {
  title: string;
  content: string;
  maxSegments: number;
  targetDurationPerSegment: number;
}

export interface SegmentResult {
  title: string;
  content: string;
  keyPoints: string[];
  estimatedDuration: number;
}

export type GenerationQueueItem = GenerationQueueRow;
export type GenerationQueueItemInsert = GenerationQueueInsertRow;

export type PublicationEvent = PublicationEventRow;
export type PublicationEventInsert = PublicationEventInsertRow;

export interface CronLog {
  id: string;
  cron_type: CronType;
  started_at: string;
  completed_at: string | null;
  status: CronExecutionStatus;
  items_processed: number;
  items_failed: number;
  errors: Json;
  summary: Json;
  created_at: string;
}

export interface CronLogInsert {
  id?: string;
  cron_type: CronType;
  started_at?: string;
  completed_at?: string | null;
  status?: CronExecutionStatus;
  items_processed?: number;
  items_failed?: number;
  errors?: Json;
  summary?: Json;
  created_at?: string;
}

export type BrandGuideline = BrandGuidelineRow;
export type BrandGuidelineInsert = BrandGuidelineInsertRow;
export type BrandGuidelineUpdate = Partial<BrandGuidelineInsertRow>;

export type YouTubeSourceStatus =
  | "pending"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "processing"
  | "completed"
  | "failed";

export type YouTubeClipStatus =
  | "pending"
  | "cutting"
  | "rendering_captions"
  | "completed"
  | "failed";

export type YouTubeSource = YouTubeSourceRow;
export type YouTubeSourceInsert = YouTubeSourceInsertRow;
export type YouTubeClip = YouTubeClipRow;
export type YouTubeClipInsert = YouTubeClipInsertRow;

export interface BrandGuidelineTyped {
  id: string;
  name: string;
  is_default: boolean;
  voice_description: string | null;
  target_audience: string | null;
  terminology: string[];
  tone_guidelines: string | null;
  content_restrictions: string | null;
  example_phrases: string[];
  created_at: string;
  updated_at: string;
}
