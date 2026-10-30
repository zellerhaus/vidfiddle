import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, feedItemToBlogPost, htmlToText, withoutLeadingTitle } from "../src/lib/rss";

test("decodeEntities handles numeric, hex and named entities", () => {
  assert.equal(decodeEntities("NASA&#8217;s Hubble &amp; Webb"), "NASA’s Hubble & Webb");
  assert.equal(decodeEntities("caf&#xe9; &lt;3"), "café <3");
});

test("htmlToText strips markup that a feed description carried", () => {
  const description = '\n  <div class="c-field c-field--name-title">\n  <div class="c-field__item">Ocean Facts: What are Kelvin waves?</div></div>';
  assert.equal(htmlToText(description), "Ocean Facts: What are Kelvin waves?");
  // NOAA escapes the markup inside its description.
  assert.equal(htmlToText('&lt;div class="c-field"&gt;Kelvin waves&lt;/div&gt; move slowly.'), "Kelvin waves move slowly.");
});

test("feedItemToBlogPost stores plain text title, content and excerpt", () => {
  const post = feedItemToBlogPost(
    {
      title: "NASA&#8217;s ISAM State of Play",
      link: "https://example.com/post",
      content: "<p>Servicing <b>satellites</b> in orbit.</p>",
      contentSnippet: '<div class="c-field">Servicing satellites</div>',
    },
    "feed-1"
  );
  assert.equal(post.title, "NASA’s ISAM State of Play");
  assert.equal(post.content, "Servicing satellites in orbit.");
  assert.equal(post.excerpt, "Servicing satellites");
});

test("excerpts drop a title the feed repeats at the start of the description", () => {
  assert.equal(
    withoutLeadingTitle("Ocean Facts: What are Kelvin waves? Kelvin waves are difficult to see.", "Ocean Facts: What are Kelvin waves?"),
    "Kelvin waves are difficult to see."
  );
  assert.equal(withoutLeadingTitle("Servicing satellites in orbit.", "NASA’s ISAM State of Play"), "Servicing satellites in orbit.");
  const post = feedItemToBlogPost(
    { title: "Aerial images now available", link: "https://example.com/a", contentSnippet: "Aerial images now available — An aerial view of Pensacola." },
    "feed-1"
  );
  assert.equal(post.excerpt, "An aerial view of Pensacola.");
});
