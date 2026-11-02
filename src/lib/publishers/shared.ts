// Helpers shared by the publisher adapters.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A publish time for auto-scheduled posts on publishers without their own slot picker: a few
 * minutes out for a single video, or one day apart per position in a batch so a bulk run
 * doesn't land every video at once.
 */
export function autoScheduledAt(batchIndex = 0, batchSize = 1, leadMs = 5 * 60_000): string {
  const offset = batchSize > 1 ? (batchIndex + 1) * DAY_MS : leadMs;
  return new Date(Date.now() + offset).toISOString();
}

/** A YouTube-safe title: the given title or the caption's first line, no angle brackets, 100 characters. */
export function videoTitle(title: string | undefined, caption: string): string {
  const firstLine = caption.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
  const cleaned = (title?.trim() || firstLine).replace(/[<>]/g, "").trim().slice(0, 100).trim();
  return cleaned.length >= 2 ? cleaned : "New video";
}

/** The human-readable message from a JSON error body (`message`, `msg` or `error`), else the raw text. */
export function errorMessageFromBody(rawBody: string, fallback: string): string {
  if (!rawBody) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    for (const key of ["message", "msg", "error"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
      if (Array.isArray(value) && value.length > 0) {
        return value.map(String).join("; ");
      }
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }

  return rawBody.slice(0, 500);
}
