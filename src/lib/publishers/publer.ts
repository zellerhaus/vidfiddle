import {
  getAccounts as getPublerAccounts,
  getPost as getPublerPost,
  isPublerConfigured as isLegacyPublerConfigured,
  scheduleVideoPost as schedulePublerVideoPost,
  waitForScheduleJob as waitForPublerScheduleJob,
  type PublerAccount,
} from "@/lib/publer";
import type {
  Publisher,
  PublisherPostStatus,
  PublisherScheduleParams,
  PublisherScheduledPost,
} from "./types";

export type { PublerAccount };

export function isPublerConfigured(): boolean {
  return isLegacyPublerConfigured();
}

export async function getAccounts(): Promise<PublerAccount[]> {
  return getPublerAccounts();
}

export function createPublerPublisher(): Publisher {
  return {
    name: "publer",
    getAccounts: getPublerAccounts,
    scheduleVideoPost: (params: PublisherScheduleParams) => {
      const accounts = params.accounts.map((account) => {
        if (!account.accountId) {
          throw new Error(`Publer requires an account ID for platform: ${account.platform}`);
        }

        return {
          ...account,
          accountId: account.accountId,
        };
      });

      return schedulePublerVideoPost({
        ...params,
        accounts,
      });
    },
    waitForScheduleJob: async (
      jobId: string,
      maxAttempts?: number,
      intervalMs?: number
    ): Promise<PublisherScheduledPost[]> => {
      const posts = await waitForPublerScheduleJob(jobId, maxAttempts, intervalMs);
      return posts.map((post) => ({
        accountId: post.accountId,
        publisherPostId: post.publerPostId,
      }));
    },
    getPost: async (postId: string): Promise<PublisherPostStatus | null> => {
      const post = await getPublerPost(postId);
      if (!post) {
        return null;
      }

      return {
        ...post,
        remote_post_id: post.id,
      };
    },
  };
}
