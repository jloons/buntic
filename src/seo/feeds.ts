import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PageRouteInfo, ResolvedConfig } from "../types.ts";
import { escapeXml } from "../utils/html.ts";

export interface ResolvedFeedEntry {
  title: string;
  description: string;
  date: Date;
  author?: string;
  url: string;
}

export function extractFeedEntries(
  routes: PageRouteInfo[],
  config: ResolvedConfig
): ResolvedFeedEntry[] {
  const siteUrl = config.site?.url ? config.site.url.replace(/\/+$/, "") : "";
  const entries: ResolvedFeedEntry[] = [];

  for (const route of routes) {
    if (route.feed) {
      const feed = route.feed;
      const fullUrl = siteUrl ? `${siteUrl}${route.urlPath}` : route.urlPath;

      let dateObj: Date;
      if (feed.date instanceof Date) {
        dateObj = feed.date;
      } else if (typeof feed.date === "string") {
        dateObj = new Date(feed.date);
      } else {
        dateObj = new Date();
      }

      entries.push({
        title: feed.title,
        description: feed.description || "",
        date: isNaN(dateObj.getTime()) ? new Date() : dateObj,
        author: feed.author,
        url: feed.url || fullUrl,
      });
    }
  }

  // Sort descending (newest first)
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  const limit = config.feeds?.limit || 20;
  return entries.slice(0, limit);
}

export function generateRss2Xml(
  routes: PageRouteInfo[],
  config: ResolvedConfig
): string | null {
  if (config.feeds?.rss === false) {
    return null;
  }

  // If user already has an RSS file in public/, respect it
  const rssFilename =
    typeof config.feeds?.rss === "string" ? config.feeds.rss : "rss.xml";
  const existingInPublic = join(config.publicDir, rssFilename);
  if (existsSync(existingInPublic)) {
    return null;
  }

  const entries = extractFeedEntries(routes, config);
  if (entries.length === 0 && !config.feeds?.rss) {
    return null; // Don't generate empty feed unless explicitly configured
  }

  const siteUrl = config.site?.url ? config.site.url.replace(/\/+$/, "") : "";
  const title = config.feeds?.title || config.site?.title || "Feed RSS";
  const description = config.feeds?.description || config.site?.description || "";
  const now = new Date().toUTCString();

  const itemsXml = entries.map((entry) => {
    return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <guid isPermaLink="true">${escapeXml(entry.url)}</guid>
      <pubDate>${entry.date.toUTCString()}</pubDate>
      <description>${escapeXml(entry.description)}</description>${
        entry.author ? `\n      <author>${escapeXml(entry.author)}</author>` : ""
      }
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl || "/")}</link>
    <description>${escapeXml(description)}</description>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(siteUrl)}/${escapeXml(rssFilename)}" rel="self" type="application/rss+xml"/>
${itemsXml.join("\n")}
  </channel>
</rss>
`;
}

export function generateAtomXml(
  routes: PageRouteInfo[],
  config: ResolvedConfig
): string | null {
  if (config.feeds?.atom === false) {
    return null;
  }

  // If user already has an Atom feed file in public/, respect it
  const atomFilename =
    typeof config.feeds?.atom === "string" ? config.feeds.atom : "atom.xml";
  const existingInPublic = join(config.publicDir, atomFilename);
  if (existsSync(existingInPublic)) {
    return null;
  }

  const entries = extractFeedEntries(routes, config);
  if (entries.length === 0 && !config.feeds?.atom) {
    return null; // Don't generate empty feed unless explicitly configured
  }

  const siteUrl = config.site?.url ? config.site.url.replace(/\/+$/, "") : "";
  const title = config.feeds?.title || config.site?.title || "Feed Atom";
  const updated = (entries[0]?.date || new Date()).toISOString();

  const entriesXml = entries.map((entry) => {
    return `  <entry>
    <id>${escapeXml(entry.url)}</id>
    <title>${escapeXml(entry.title)}</title>
    <link href="${escapeXml(entry.url)}" rel="alternate"/>
    <updated>${entry.date.toISOString()}</updated>
    <summary>${escapeXml(entry.description)}</summary>${
      entry.author ? `\n    <author><name>${escapeXml(entry.author)}</name></author>` : ""
    }
  </entry>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(siteUrl || "/")}</id>
  <title>${escapeXml(title)}</title>
  <updated>${updated}</updated>
  <link href="${escapeXml(siteUrl || "/")}" rel="alternate"/>
  <link href="${escapeXml(siteUrl)}/${escapeXml(atomFilename)}" rel="self" type="application/atom+xml"/>
${entriesXml.join("\n")}
</feed>
`;
}
