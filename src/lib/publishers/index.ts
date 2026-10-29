import { createLightPostPublisher } from "./lightpost";
import { createPublerPublisher } from "./publer";
import type { Publisher } from "./types";

export * from "./types";

export const NO_PUBLISHER_CONFIG_MESSAGE =
  "No publisher configured. Set PUBLER_API_KEY or LIGHTPOST_URL.";

let cachedPubler: { key: string; publisher: Publisher } | null = null;
let cachedLightPost: { key: string; publisher: Publisher } | null = null;

function getPublerPublisher(): Publisher {
  const key = `${process.env.PUBLER_API_KEY || ""}|${process.env.PUBLER_WORKSPACE_ID || ""}`;
  if (!cachedPubler || cachedPubler.key !== key) {
    cachedPubler = {
      key,
      publisher: createPublerPublisher(),
    };
  }
  return cachedPubler.publisher;
}

function getLightPostPublisher(): Publisher {
  const key = `${process.env.LIGHTPOST_URL || ""}|${process.env.LIGHTPOST_PASSWORD || ""}|${process.env.LIGHTPOST_ACCOUNTS || ""}`;
  if (!cachedLightPost || cachedLightPost.key !== key) {
    cachedLightPost = {
      key,
      publisher: createLightPostPublisher(),
    };
  }
  return cachedLightPost.publisher;
}

function getRequestedPublisher(): "publer" | "lightpost" | null {
  const raw = process.env.PUBLISHER?.trim().toLowerCase();
  if (raw === "publer" || raw === "lightpost") {
    return raw;
  }
  return null;
}

export function getPublisher(): Publisher | null {
  const requested = getRequestedPublisher();

  if (requested === "publer") {
    return process.env.PUBLER_API_KEY ? getPublerPublisher() : null;
  }

  if (requested === "lightpost") {
    return process.env.LIGHTPOST_URL ? getLightPostPublisher() : null;
  }

  if (process.env.PUBLER_API_KEY) {
    return getPublerPublisher();
  }

  if (process.env.LIGHTPOST_URL) {
    return getLightPostPublisher();
  }

  return null;
}
