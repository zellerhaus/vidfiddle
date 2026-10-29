import { JSDOM } from "jsdom";

interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VideoGenerator/1.0; +https://videogen.app)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Try WordPress/standard article extraction first
  const title = extractTitle(doc);
  const content = extractArticleContent(doc);
  const excerpt = extractExcerpt(doc, content);
  const featuredImage = extractFeaturedImage(doc);
  const publishedAt = extractPublishedDate(doc);

  if (!title || !content) {
    throw new Error("Could not extract content from this URL");
  }

  return {
    title,
    content,
    excerpt,
    featuredImage,
    publishedAt,
  };
}

function extractTitle(doc: Document): string | null {
  // Try Open Graph title first
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle) return ogTitle.getAttribute("content");

  // Try Twitter card title
  const twitterTitle = doc.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) return twitterTitle.getAttribute("content");

  // Try article title
  const articleTitle = doc.querySelector("article h1, .entry-title, .post-title");
  if (articleTitle) return articleTitle.textContent?.trim() || null;

  // Fall back to page title
  const pageTitle = doc.querySelector("title");
  if (pageTitle) return pageTitle.textContent?.trim() || null;

  return null;
}

function extractArticleContent(doc: Document): string | null {
  // Try common WordPress/blog selectors
  const selectors = [
    "article .entry-content",
    "article .post-content",
    ".entry-content",
    ".post-content",
    "article .content",
    ".article-content",
    ".blog-post-content",
    "article",
    '[role="main"] article',
    "main article",
  ];

  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) {
      // Remove scripts, styles, and other non-content elements
      const clone = element.cloneNode(true) as Element;
      clone
        .querySelectorAll("script, style, nav, aside, .comments, .sidebar, .related-posts")
        .forEach((el) => el.remove());

      // Get text content
      const text = clone.textContent?.trim();
      if (text && text.length > 100) {
        return cleanText(text);
      }
    }
  }

  return null;
}

function extractExcerpt(doc: Document, fullContent: string | null): string | null {
  // Try meta description
  const metaDesc = doc.querySelector('meta[name="description"]');
  if (metaDesc) {
    const desc = metaDesc.getAttribute("content");
    if (desc) return desc.slice(0, 300);
  }

  // Try Open Graph description
  const ogDesc = doc.querySelector('meta[property="og:description"]');
  if (ogDesc) {
    const desc = ogDesc.getAttribute("content");
    if (desc) return desc.slice(0, 300);
  }

  // Fall back to first 300 chars of content
  if (fullContent) {
    return fullContent.slice(0, 300) + (fullContent.length > 300 ? "..." : "");
  }

  return null;
}

function extractFeaturedImage(doc: Document): string | null {
  // Try Open Graph image
  const ogImage = doc.querySelector('meta[property="og:image"]');
  if (ogImage) return ogImage.getAttribute("content");

  // Try Twitter card image
  const twitterImage = doc.querySelector('meta[name="twitter:image"]');
  if (twitterImage) return twitterImage.getAttribute("content");

  // Try first image in article
  const articleImg = doc.querySelector("article img");
  if (articleImg) return articleImg.getAttribute("src");

  return null;
}

function extractPublishedDate(doc: Document): string | null {
  // Try schema.org datePublished
  const schemaDate = doc.querySelector('[itemprop="datePublished"]');
  if (schemaDate) {
    const date =
      schemaDate.getAttribute("content") || schemaDate.textContent;
    if (date) return new Date(date).toISOString();
  }

  // Try article:published_time
  const articleTime = doc.querySelector('meta[property="article:published_time"]');
  if (articleTime) {
    const date = articleTime.getAttribute("content");
    if (date) return new Date(date).toISOString();
  }

  // Try time element
  const timeEl = doc.querySelector("article time");
  if (timeEl) {
    const date = timeEl.getAttribute("datetime") || timeEl.textContent;
    if (date) return new Date(date).toISOString();
  }

  return null;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n") // Max 2 newlines
    .trim();
}
