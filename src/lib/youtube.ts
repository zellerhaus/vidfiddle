/**
 * YouTube URL validation and video ID extraction
 */

const YOUTUBE_PATTERNS = [
  // youtube.com/watch?v=VIDEO_ID
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
  // youtu.be/VIDEO_ID
  /(?:youtu\.be\/)([\w-]{11})/,
  // youtube.com/shorts/VIDEO_ID
  /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  // youtube.com/embed/VIDEO_ID
  /(?:youtube\.com\/embed\/)([\w-]{11})/,
  // youtube.com/v/VIDEO_ID
  /(?:youtube\.com\/v\/)([\w-]{11})/,
];

/**
 * Extract YouTube video ID from various URL formats.
 * Returns null if the URL is not a valid YouTube URL.
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const normalized = url.trim();
    for (const pattern of YOUTUBE_PATTERNS) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL is a valid YouTube URL
 */
export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeVideoId(url) !== null;
}

/**
 * Build a canonical YouTube watch URL from a video ID
 */
export function buildYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
