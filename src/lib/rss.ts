import { XMLParser } from "fast-xml-parser";
import type { BlogPostInsert } from "./supabase/types";

interface FeedItem {
  title: string;
  link: string;
  content?: string;
  contentSnippet?: string;
  pubDate?: string;
  isoDate?: string;
}

interface ParsedFeed {
  title?: string;
  description?: string;
  link?: string;
  items: FeedItem[];
}

export async function parseFeed(url: string): Promise<ParsedFeed> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Vidfiddle/1.0 (+https://github.com/zellerhaus/vidfiddle)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  const text = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    isArray: (name) => ["item", "entry"].includes(name),
  });

  let parsed;
  try {
    parsed = parser.parse(text);
  } catch {
    throw new Error("Invalid RSS feed format");
  }

  // Try RSS 2.0 format first
  const channel = parsed?.rss?.channel;
  if (channel) {
    return parseRss2(channel);
  }

  // Try Atom format
  const feed = parsed?.feed;
  if (feed) {
    return parseAtom(feed);
  }

  throw new Error("Unknown feed format");
}

function getTextValue(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && node !== null && "#text" in node) {
    return String((node as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRss2(channel: any): ParsedFeed {
  const title = getTextValue(channel.title);
  const description = getTextValue(channel.description);
  const link = getTextValue(channel.link);

  const items = (Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      const contentEncoded = getTextValue(item["content:encoded"]) || getTextValue(item.description) || "";
      const descText = getTextValue(item.description) || "";

      return {
        title: getTextValue(item.title) || "Untitled",
        link: getTextValue(item.link) || "",
        content: contentEncoded,
        // Clean before truncating: cutting raw HTML can leave half a tag behind.
        contentSnippet: htmlToText(descText).slice(0, 200),
        pubDate: getTextValue(item.pubDate) || undefined,
      };
    });

  return { title, description, link, items };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAtom(feed: any): ParsedFeed {
  const title = getTextValue(feed.title);
  const description = getTextValue(feed.subtitle);

  // Find the alternate link or first link
  const links = Array.isArray(feed.link) ? feed.link : feed.link ? [feed.link] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const altLink = links.find((l: any) => l?.["@_rel"] === "alternate") || links[0];
  const link = typeof altLink === "string" ? altLink : altLink?.["@_href"];

  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = entries.map((entry: any) => {
    const entryLinks = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entryAltLink = entryLinks.find((l: any) => l?.["@_rel"] === "alternate") || entryLinks[0];
    const entryHref = typeof entryAltLink === "string" ? entryAltLink : entryAltLink?.["@_href"];

    return {
      title: getTextValue(entry.title) || "Untitled",
      link: entryHref || "",
      content: getTextValue(entry.content) || getTextValue(entry.summary) || "",
      contentSnippet: htmlToText(getTextValue(entry.summary) || "").slice(0, 200),
      pubDate: getTextValue(entry.published) || getTextValue(entry.updated) || undefined,
    };
  });

  return { title, description, link, items };
}

/** Decodes the HTML entities feeds commonly leave in titles and text (&#8217;, &amp;, ...). */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => named[e]);
}

/** Plain text from feed HTML: tags removed, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  // Strip, decode, then strip again: some feeds escape the HTML inside their descriptions.
  const strip = (text: string) => text.replace(/<[^>]*>/g, " ");
  return strip(decodeEntities(strip(html))).replace(/\s+/g, " ").trim();
}

/** Drop the title when a feed repeats it at the start of the description. */
export function withoutLeadingTitle(text: string, title: string): string {
  const t = title.trim();
  if (t && text.toLowerCase().startsWith(t.toLowerCase())) {
    return text.slice(t.length).replace(/^[\s:–—|-]+/, "");
  }
  return text;
}

export function feedItemToBlogPost(
  item: FeedItem,
  feedId: string
): BlogPostInsert {
  // Feeds send HTML (sometimes escaped inside the description), so store plain text everywhere.
  const cleanContent = htmlToText(item.content || "");
  const cleanSnippet = htmlToText(item.contentSnippet || "");
  const title = decodeEntities(item.title);

  return {
    feed_id: feedId,
    url: item.link,
    title,
    content: cleanContent || cleanSnippet,
    excerpt: withoutLeadingTitle(cleanSnippet || cleanContent, title).slice(0, 300) || undefined,
    published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    status: "new",
  };
}
