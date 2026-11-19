import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { Builder, detectPublicCollisions, assertNoPublicCollisions } from "../src/builder/builder.ts";
import { generateSitemapXml } from "../src/seo/sitemap.ts";
import { generateRss2Xml, generateAtomXml } from "../src/seo/feeds.ts";
import type { PageRouteInfo } from "../src/types.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-public-collisions");

describe("Public Collisions Detection & SEO Respect", () => {
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
      templateFilePath: join(tmpDir, "pages/index.html"),
      urlPath: "/",
      outputFilePath: join(tmpDir, "dist/index.html"),
      params: {},
      props: {},
      isDynamic: false,
    },
    {
      patternRelativePath: "about.html",
      templateFilePath: join(tmpDir, "pages/about.html"),
      urlPath: "/about",
      outputFilePath: join(tmpDir, "dist/about.html"),
      params: {},
      props: {},
      isDynamic: false,
    },
    {
      patternRelativePath: "blog/[slug].html",
      templateFilePath: join(tmpDir, "pages/blog/[slug].html"),
      urlPath: "/blog/primer-post",
      outputFilePath: join(tmpDir, "dist/blog/primer-post/index.html"),
      params: { slug: "primer-post" },
      props: {},
      isDynamic: true,
    },
  ];

  test("detects collision when a file in public/ has the same output path as a static page", async () => {
    const config = await resolveConfig(tmpDir);

    // Place a conflicting file in public/
    await Bun.write(join(tmpDir, "public/about.html"), "<h1>Public About</h1>");

    const collisions = detectPublicCollisions(config, mockRoutes);
    expect(collisions.length).toBe(1);
    expect(collisions[0].type).toBe("route");
    expect(collisions[0].outputPath).toBe("about.html");
    expect(collisions[0].publicPath).toContain("about.html");
    expect(collisions[0].conflictWith).toContain("about.html");
  });

  test("detects collision when a file in public/ conflicts with a dynamic route clean URL", async () => {
    const config = await resolveConfig(tmpDir);

    // Place a conflicting file for dynamic route
    mkdirSync(join(tmpDir, "public/blog/primer-post"), { recursive: true });
    await Bun.write(join(tmpDir, "public/blog/primer-post/index.html"), "<h1>Public Post</h1>");

    const collisions = detectPublicCollisions(config, mockRoutes);
    expect(collisions.length).toBe(1);
    expect(collisions[0].type).toBe("route");
    expect(collisions[0].outputPath).toBe("blog/primer-post/index.html");
  });

  test("detects collision when public/ contains files in reserved internal directories", async () => {
    const config = await resolveConfig(tmpDir);

    mkdirSync(join(tmpDir, "public/assets/images"), { recursive: true });
    await Bun.write(join(tmpDir, "public/assets/images/custom.webp"), "fake webp");

    const collisions = detectPublicCollisions(config, mockRoutes);
    expect(collisions.length).toBe(1);
    expect(collisions[0].type).toBe("reserved-dir");
    expect(collisions[0].outputPath).toBe("assets/images/custom.webp");
  });

  test("assertNoPublicCollisions throws an actionable [Bustatic Collision Error]", async () => {
    const config = await resolveConfig(tmpDir);

    await Bun.write(join(tmpDir, "public/index.html"), "<h1>Static Public Index</h1>");

    expect(() => {
      assertNoPublicCollisions(config, mockRoutes);
    }).toThrow(/\[Bustatic Collision Error\]/);

    try {
      assertNoPublicCollisions(config, mockRoutes);
    } catch (err: any) {
      expect(err.message).toContain("Conflict detected between public/ files");
      expect(err.message).toContain("index.html");
      expect(err.message).toContain("👉 Action:");
    }
  });

  test("Builder.build aborts immediately and throws if a public collision exists", async () => {
    await Bun.write(join(tmpDir, "pages/index.html"), "<h1>Home</h1>");
    await Bun.write(join(tmpDir, "public/index.html"), "<h1>Conflict</h1>");

    const config = await resolveConfig(tmpDir);
    const builder = new Builder(config);

    expect(builder.build()).rejects.toThrow(/\[Bustatic Collision Error\]/);
  });

  test("SEO generators respect custom sitemap.xml, rss.xml and atom.xml in public/", async () => {
    const config = await resolveConfig(tmpDir, {
      site: { url: "https://example.com", title: "Test Site" },
      feeds: { rss: true, atom: true },
    });

    // Write custom files to public/
    await Bun.write(join(tmpDir, "public/sitemap.xml"), "<custom-sitemap/>");
    await Bun.write(join(tmpDir, "public/rss.xml"), "<custom-rss/>");
    await Bun.write(join(tmpDir, "public/atom.xml"), "<custom-atom/>");

    // All generators should return null to preserve the custom public files
    expect(generateSitemapXml(mockRoutes, config)).toBeNull();
    expect(generateRss2Xml(mockRoutes, config)).toBeNull();
    expect(generateAtomXml(mockRoutes, config)).toBeNull();
  });
});
