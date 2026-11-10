import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { Builder } from "../src/builder/builder.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-builder-phase2");

describe("Builder Phase 2 Integration (Assets, Storage, SEO & Feeds)", () => {
  let samplePngBytes: Uint8Array;

  beforeEach(async () => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "pages/blog"), { recursive: true });
    mkdirSync(join(tmpDir, "layouts"), { recursive: true });
    mkdirSync(join(tmpDir, "storage"), { recursive: true });
    mkdirSync(join(tmpDir, "public"), { recursive: true });

    // Generate 100x100 test PNG
    const png2x2 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGBgYAAJkBA4Y4dJ8AAAAASUVORK5CYII=",
      "base64"
    );
    const img = new Bun.Image(png2x2);
    const scaled = await img.resize(100, 100);
    const png = await scaled.png();
    samplePngBytes = await png.bytes();

    await Bun.write(join(tmpDir, "public/local-hero.png"), samplePngBytes);

    // Write config
    const configCode = `
      export default {
        site: {
          url: "https://bustatic-demo.com",
          title: "Bustatic Demo",
          description: "Sitio de prueba"
        },
        seo: {
          sitemap: true,
          robots: true
        },
        feeds: {
          rss: true,
          atom: true
        }
      };
    `;
    await Bun.write(join(tmpDir, "bustatic.config.ts"), configCode);

    // Write storage/s3.ts
    const s3Code = `
      export default async function(key: string) {
        return {
          bytes: Buffer.from('${Buffer.from(samplePngBytes).toString("base64")}', 'base64'),
          etag: '"etag-phase2-v1"'
        };
      }
    `;
    await Bun.write(join(tmpDir, "storage/s3.ts"), s3Code);

    // Write base layout
    const layoutCode = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body>
        <header>Header</header>
        <slot></slot>
      </body>
      </html>
    `;
    await Bun.write(join(tmpDir, "layouts/main.html"), layoutCode);

    // Write home page with <photo> and <seo>
    const homeHtml = `
      <layout src="../layouts/main.html">
        <seo title="Inicio" description="Bienvenido a mi sitio" image-key="banners/home.png" />
        <h1>Página Principal</h1>
        <photo src="/local-hero.png" alt="Local hero" widths="50,100" />
        <photo key="products/shoe.jpg" alt="Remote shoe" />
      </layout>
    `;
    await Bun.write(join(tmpDir, "pages/index.html"), homeHtml);

    // Write dynamic blog page
    const blogHtml = `
      <layout src="../../layouts/main.html">
        <h1>{{ post.title }}</h1>
        <p>{{ post.content }}</p>
      </layout>
    `;
    await Bun.write(join(tmpDir, "pages/blog/[slug].html"), blogHtml);

    const blogData = `
      export default async function() {
        return [
          {
            params: { slug: "articulo-1" },
            props: { post: { title: "Artículo 1", content: "Contenido 1" } },
            seo: {
              title: "Artículo 1 | Blog",
              description: "Descripción del artículo 1"
            },
            feed: {
              title: "Artículo 1",
              description: "Descripción feed 1",
              date: "2026-05-15T00:00:00Z"
            }
          }
        ];
      }
    `;
    await Bun.write(join(tmpDir, "pages/blog/[slug].data.ts"), blogData);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("builds site with photos, remote storage, SEO metatags, sitemap, robots and feeds", async () => {
    const config = await resolveConfig(tmpDir);
    const builder = new Builder(config);

    const result = await builder.build();

    expect(result.success).toBe(true);
    expect(result.pagesCount).toBe(2); // index and blog/articulo-1

    // 1. Check index.html output
    const indexHtml = await Bun.file(join(tmpDir, "dist/index.html")).text();
    expect(indexHtml).toContain("<title>Inicio</title>");
    expect(indexHtml).toContain('<meta property="og:title" content="Inicio">');
    expect(indexHtml).toContain('<link rel="canonical" href="https://bustatic-demo.com">');
    expect(indexHtml).toContain('<meta property="og:image" content="https://bustatic-demo.com/assets/seo/');
    expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(indexHtml).not.toContain("<seo");

    // Check <photo> converted to <img>
    expect(indexHtml).not.toContain("<photo");
    expect(indexHtml).toContain('<img src="/assets/images/');
    expect(indexHtml).toContain('srcset="/assets/images/');
    expect(indexHtml).toContain('width="100"');
    expect(indexHtml).toContain('height="100"');
    expect(indexHtml).toContain('loading="lazy"');
    expect(indexHtml).toContain('decoding="async"');

    // 2. Check blog/articulo-1/index.html output
    const blogPostHtml = await Bun.file(
      join(tmpDir, "dist/blog/articulo-1/index.html")
    ).text();
    expect(blogPostHtml).toContain("<title>Artículo 1 | Blog</title>");
    expect(blogPostHtml).toContain('<link rel="canonical" href="https://bustatic-demo.com/blog/articulo-1">');
    expect(blogPostHtml).toContain("Artículo 1");

    // 3. Check SEO artifacts in dist/
    expect(existsSync(join(tmpDir, "dist/sitemap.xml"))).toBe(true);
    const sitemap = await Bun.file(join(tmpDir, "dist/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://bustatic-demo.com/</loc>");
    expect(sitemap).toContain("<loc>https://bustatic-demo.com/blog/articulo-1</loc>");

    expect(existsSync(join(tmpDir, "dist/robots.txt"))).toBe(true);
    const robots = await Bun.file(join(tmpDir, "dist/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://bustatic-demo.com/sitemap.xml");

    expect(existsSync(join(tmpDir, "dist/rss.xml"))).toBe(true);
    const rss = await Bun.file(join(tmpDir, "dist/rss.xml")).text();
    expect(rss).toContain("<title>Artículo 1</title>");

    expect(existsSync(join(tmpDir, "dist/atom.xml"))).toBe(true);
    const atom = await Bun.file(join(tmpDir, "dist/atom.xml")).text();
    expect(atom).toContain("<title>Artículo 1</title>");

    // 4. Check persistent cache created
    expect(existsSync(join(tmpDir, ".bustatic/cache/images"))).toBe(true);

    // 5. Build with cleanCache
    const cleanResult = await builder.build({ cleanCache: true });
    expect(cleanResult.success).toBe(true);
  });
});
