import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { generateSitemapXml } from "../src/seo/sitemap.ts";
import { generateRobotsTxt } from "../src/seo/robots.ts";
import { generateRss2Xml, generateAtomXml } from "../src/seo/feeds.ts";
import type { PageRouteInfo } from "../src/types.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-seo-files");

describe("Sitemap, Robots.txt & Feeds (RSS 2.0 / Atom)", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    mkdirSync(join(tmpDir, "public"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const mockRoutes: PageRouteInfo[] = [
    {
      patternRelativePath: "index.html",
      templateFilePath: "/pages/index.html",
      urlPath: "/",
      outputFilePath: "/dist/index.html",
      params: {},
      props: {},
      isDynamic: false,
    },
    {
      patternRelativePath: "blog/[slug].html",
      templateFilePath: "/pages/blog/[slug].html",
      urlPath: "/blog/primer-post",
      outputFilePath: "/dist/blog/primer-post/index.html",
      params: { slug: "primer-post" },
      props: {},
      isDynamic: true,
      feed: {
        title: "Primer Post",
        description: "Contenido del primer post",
        date: new Date("2026-05-10T10:00:00Z"),
        author: "Dev",
      },
    },
    {
      patternRelativePath: "blog/[slug].html",
      templateFilePath: "/pages/blog/[slug].html",
      urlPath: "/blog/segundo-post",
      outputFilePath: "/dist/blog/segundo-post/index.html",
      params: { slug: "segundo-post" },
      props: {},
      isDynamic: true,
      feed: {
        title: "Segundo Post (Más Reciente)",
        description: "Contenido del segundo post",
        date: new Date("2026-05-12T10:00:00Z"),
        author: "Dev",
      },
    },
  ];

  test("generates sitemap.xml with all routes and clean canonical URLs", async () => {
    const config = await resolveConfig(tmpDir, {
      site: { url: "https://misitio.com" },
    });

    const xml = generateSitemapXml(mockRoutes, config);

    expect(xml).not.toBeNull();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>https://misitio.com/</loc>");
    expect(xml).toContain("<loc>https://misitio.com/blog/primer-post</loc>");
    expect(xml).toContain("<loc>https://misitio.com/blog/segundo-post</loc>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
  });

  test("generates robots.txt referencing sitemap.xml and respects public/robots.txt", async () => {
    const config = await resolveConfig(tmpDir, {
      site: { url: "https://misitio.com" },
    });

    const robots = generateRobotsTxt(config);
    expect(robots).not.toBeNull();
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Sitemap: https://misitio.com/sitemap.xml");

    // If public/robots.txt exists, should return null to not overwrite
    await Bun.write(join(tmpDir, "public/robots.txt"), "User-agent: Googlebot\nDisallow: /");
    const robotsExisting = generateRobotsTxt(config);
    expect(robotsExisting).toBeNull();
  });

  test("generates RSS 2.0 feed sorted descending by date", async () => {
    const config = await resolveConfig(tmpDir, {
      site: { url: "https://misitio.com", title: "Mi Blog" },
      feeds: { rss: true },
    });

    const rss = generateRss2Xml(mockRoutes, config);

    expect(rss).not.toBeNull();
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain("<title>Mi Blog</title>");
    expect(rss).toContain("<title>Segundo Post (Más Reciente)</title>");
    expect(rss).toContain("<title>Primer Post</title>");

    // Check chronological order (segundo-post should appear before primer-post)
    const posSegundo = rss!.indexOf("Segundo Post");
    const posPrimer = rss!.indexOf("Primer Post");
    expect(posSegundo).toBeLessThan(posPrimer);
  });

  test("generates Atom 1.0 feed sorted descending by date", async () => {
    const config = await resolveConfig(tmpDir, {
      site: { url: "https://misitio.com", title: "Mi Blog Atom" },
      feeds: { atom: true },
    });

    const atom = generateAtomXml(mockRoutes, config);

    expect(atom).not.toBeNull();
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(atom).toContain("<title>Mi Blog Atom</title>");
    expect(atom).toContain("<title>Segundo Post (Más Reciente)</title>");
    expect(atom).toContain("<updated>2026-05-12T10:00:00.000Z</updated>");
  });
});
