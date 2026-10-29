import type { Platform } from "@/lib/supabase/types";

export type PublisherName = "publer" | "lightpost";

export interface PublisherAccount {
  id: string;
  name: string;
  platform: string;
  profile_url?: string;
  avatar_url?: string;
  username?: string;
}

export interface PublisherScheduleAccount {
  accountId?: string;
  platform: Platform;
  caption: string;
  title?: string;
  scheduledAt?: string;
}

export interface PublisherScheduleParams {
  videoUrl: string;
  accounts: PublisherScheduleAccount[];
  autoSchedule?: boolean;
  batchIndex?: number;
  batchSize?: number;
}

export interface PublisherScheduledPost {
  publisherPostId: string;
  accountId: string;
}

export interface PublisherPostStatus {
  id: string;
  state: string;
  scheduled_at?: string;
  published_at?: string;
  error?: string;
  post_link?: string;
  remote_post_id?: string;
}

export interface Publisher {
  name: PublisherName;
  getAccounts(): Promise<PublisherAccount[]>;
  scheduleVideoPost(params: PublisherScheduleParams): Promise<{ jobId: string; mediaId?: string }>;
  waitForScheduleJob(
    jobId: string,
    maxAttempts?: number,
    intervalMs?: number
  ): Promise<PublisherScheduledPost[]>;
  getPost(postId: string): Promise<PublisherPostStatus | null>;
}
