import { createLightPostPublisher } from "./lightpost";
import { createPostizPublisher } from "./postiz";
import { createPublerPublisher } from "./publer";
import { createTryPostPublisher } from "./trypost";
import type { Publisher, PublisherName } from "./types";

export * from "./types";

export const NO_PUBLISHER_CONFIG_MESSAGE =
  "No publisher configured. Set PUBLER_API_KEY, POSTIZ_API_KEY, TRYPOST_API_KEY or LIGHTPOST_URL.";

interface PublisherEntry {
  configured: () => boolean;
  // A publisher instance is rebuilt when any of its settings change.
  cacheKey: () => string;
  create: () => Publisher;
}

// Without PUBLISHER, the first configured one in this order is used. LightPost is experimental, so last.
const PUBLISHERS: Record<PublisherName, PublisherEntry> = {
  publer: {
    configured: () => !!process.env.PUBLER_API_KEY,
    cacheKey: () => `${process.env.PUBLER_API_KEY || ""}|${process.env.PUBLER_WORKSPACE_ID || ""}`,
    create: createPublerPublisher,
  },
  postiz: {
    configured: () => !!process.env.POSTIZ_API_KEY,
    cacheKey: () => `${process.env.POSTIZ_API_KEY || ""}|${process.env.POSTIZ_URL || ""}`,
    create: createPostizPublisher,
  },
  trypost: {
    configured: () => !!process.env.TRYPOST_API_KEY,
    cacheKey: () => `${process.env.TRYPOST_API_KEY || ""}|${process.env.TRYPOST_URL || ""}`,
    create: createTryPostPublisher,
  },
  lightpost: {
    configured: () => !!process.env.LIGHTPOST_URL,
    cacheKey: () =>
      `${process.env.LIGHTPOST_URL || ""}|${process.env.LIGHTPOST_PASSWORD || ""}|${process.env.LIGHTPOST_ACCOUNTS || ""}`,
    create: createLightPostPublisher,
  },
};

const PUBLISHER_NAMES = Object.keys(PUBLISHERS) as PublisherName[];
const cache = new Map<PublisherName, { key: string; publisher: Publisher }>();

function getCachedPublisher(name: PublisherName): Publisher {
  const entry = PUBLISHERS[name];
  const key = entry.cacheKey();
  const cached = cache.get(name);
  if (cached && cached.key === key) {
    return cached.publisher;
  }

  const publisher = entry.create();
  cache.set(name, { key, publisher });
  return publisher;
}

function getRequestedPublisher(): PublisherName | null {
  const raw = process.env.PUBLISHER?.trim().toLowerCase();
  return PUBLISHER_NAMES.find((name) => name === raw) ?? null;
}

/** Whether a publisher has the settings it needs, whether or not it's the active one. */
export function isPublisherConfigured(name: PublisherName): boolean {
  return PUBLISHERS[name].configured();
}

export function getPublisher(): Publisher | null {
  const requested = getRequestedPublisher();

  if (requested) {
    return PUBLISHERS[requested].configured() ? getCachedPublisher(requested) : null;
  }

  const firstConfigured = PUBLISHER_NAMES.find((name) => PUBLISHERS[name].configured());
  return firstConfigured ? getCachedPublisher(firstConfigured) : null;
}
