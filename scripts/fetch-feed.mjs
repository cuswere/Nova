import fs from "node:fs/promises";

const FEED_URL =
  "https://blog.praxiscenterforaesthetics.com/tag/art-opportunities/feed/";

function textBetween(str, startTag, endTag) {
  const a = str.indexOf(startTag);
  if (a === -1) return "";
  const b = str.indexOf(endTag, a + startTag.length);
  if (b === -1) return "";
  return str.slice(a + startTag.length, b).trim();
}

function stripCdata(s) {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeBasicEntities(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, "").trim();
}

const xml = await fetch(FEED_URL).then((r) => {
  if (!r.ok) throw new Error(`Feed fetch failed: ${r.status}`);
  return r.text();
});

// crude but effective for WP RSS: split items
const itemsXml = xml.split("<item>").slice(1).map((x) => x.split("</item>")[0]);

const items = itemsXml.map((itemXml) => {
  const title = decodeBasicEntities(stripCdata(textBetween(itemXml, "<title>", "</title>")));
  const link = textBetween(itemXml, "<link>", "</link>");
  const pubDate = textBetween(itemXml, "<pubDate>", "</pubDate>");
  const rawDesc = stripCdata(textBetween(itemXml, "<description>", "</description>"));
  const excerpt = stripHtml(decodeBasicEntities(rawDesc)).replace(/\s+/g, " ").slice(0, 220);

  return { title, link, pubDate, excerpt };
});

// newest first (RSS already is, but don’t assume)
items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/art-opportunities.json", JSON.stringify({ feed: FEED_URL, items }, null, 2));
console.log(`Wrote data/art-opportunities.json (${items.length} items)`);