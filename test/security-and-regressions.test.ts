import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PageRouteInfo, ResolvedConfig } from "../src/types.ts";
import { startDevServer } from "../src/server/dev.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { PhotoProcessor } from "../src/assets/photo-tag.ts";
import { isIgnoredPath } from "../src/template/vfs.ts";
import { generateAtomXml, generateRss2Xml } from "../src/seo/feeds.ts";
import { OrasClient } from "../src/storage/oras/client.ts";
import { ANNOTATIONS, MEDIA_TYPES } from "../src/storage/oras/types.ts";

describe("Security & Regression Fixes", () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix = "bustatic-sec-"): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function makeConfig(root: string, port = 34599): ResolvedConfig {
    return {
      root,
      pagesDir: join(root, "src/pages"),
      layoutsDir: join(root, "src/layouts"),
      componentsDir: join(root, "src/components"),
      dataDir: join(root, "src/data"),
      publicDir: join(root, "src/public"),
      storageDir: join(root, "src/storage"),
      cacheDir: join(root, ".bustatic/cache/images"),
      outDir: join(root, "dist"),
      port,
      minify: false,
      cssStrategy: "inline",
      site: {
        url: "https://example.com",
        title: "Security Test Site",
      },
    };
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("DevServer blocks path traversal attempts and escapes HTML in 404/500 responses", async () => {
    const parent = makeTempDir();
    const projectRoot = join(parent, "site");
    const secretFile = join(parent, "secret.txt");
    writeFileSync(secretFile, "TOP_SECRET_DATA", "utf8");

    const config = makeConfig(projectRoot, 34591);
    mkdirSync(config.pagesDir, { recursive: true });
    mkdirSync(config.publicDir, { recursive: true });
    writeFileSync(join(config.pagesDir, "index.html"), "<h1>Home</h1>", "utf8");
    writeFileSync(join(config.pagesDir, "broken.html"), `<layout src="./missing.html"></layout>`, "utf8");

    const server = startDevServer(config);
    try {
      // 1. Path traversal attempt with encoded dots
      const traversalRes = await fetch(`http://localhost:${server.port}/%2e%2e/secret.txt`);
      expect(traversalRes.status).toBe(404);
      const traversalBody = await traversalRes.text();
      expect(traversalBody).not.toContain("TOP_SECRET_DATA");

      // 2. Reflected XSS attempt in 404 pathname
      const xssRes = await fetch(
        `http://localhost:${server.port}/%3Cscript%3Ealert(1)%3C/script%3E`
      );
      expect(xssRes.status).toBe(404);
      const xssBody = await xssRes.text();
      expect(xssBody).not.toContain("<script>alert(1)</script>");
      expect(xssBody).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

      // 3. Escaped error message in 500 error page
      const errRes = await fetch(`http://localhost:${server.port}/broken`);
      expect(errRes.status).toBe(500);
      const errBody = await errRes.text();
      expect(errBody).toContain("[Bustatic Template Error]");
      expect(errBody).toContain("Layout not found");
    } finally {
      server.stop();
    }
  });

  test("OrasClient.pull rejects unsafe layer titles attempting path traversal", async () => {
    const outdir = makeTempDir("bustatic-oras-out-");
    const evilManifest = {
      schemaVersion: 2 as const,
      mediaType: MEDIA_TYPES.OCI_IMAGE_MANIFEST_V1,
      config: {
        mediaType: MEDIA_TYPES.OCI_EMPTY_CONFIG_V1,
        digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        size: 2,
      },
      layers: [
        {
          mediaType: "application/octet-stream",
          digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          size: 4,
          annotations: {
            [ANNOTATIONS.TITLE]: "../../escaped.txt",
          },
        },
      ],
    };

    const mockRegistry = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.includes("/manifests/")) {
          return Response.json(evilManifest);
        }
        return new Response("evil", { status: 200 });
      },
    });

    try {
      const client = new OrasClient({
        hostname: `localhost:${mockRegistry.port}`,
        insecure: true,
      });

      await expect(
        client.pull({ target: "repo/evil:latest", outdir })
      ).rejects.toThrow("Unsafe OCI layer title");
      expect(existsSync(join(outdir, "..", "..", "escaped.txt"))).toBe(false);
    } finally {
      mockRegistry.stop();
    }
  });

  test("TemplateEngine and PhotoProcessor preserve literal $&, $1, $$ replacement patterns", async () => {
    const root = makeTempDir();
    const config = makeConfig(root);
    mkdirSync(config.pagesDir, { recursive: true });
    mkdirSync(config.componentsDir, { recursive: true });

    // Create a minimal valid 1x1 PNG file
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const imgPath = join(config.root, "pixel.png");
    await Bun.write(imgPath, pngBytes);

    writeFileSync(
      join(config.componentsDir, "price.html"),
      `<span class="price">{{ amount }}</span>`,
      "utf8"
    );

    const engine = new TemplateEngine(config);
    const rendered = await engine.renderPage(
      `<component src="price.html" amount="$& $$ $1 99.00" />`,
      join(config.pagesDir, "index.html")
    );
    expect(rendered).toContain(`<span class="price">$& $$ $1 99.00</span>`);

    const photoProcessor = new PhotoProcessor(config);
    const photoHtml = await photoProcessor.processHtml(
      `<photo src="/pixel.png" alt="Price $& $$ $1" />`,
      join(config.pagesDir, "index.html")
    );
    expect(photoHtml).toContain(`alt="Price $&amp; $$ $1"`);
  });

  test("RSS 2.0 and Atom 1.0 feeds use custom filenames in atom:link self href", () => {
    const root = makeTempDir();
    const config = makeConfig(root);
    config.feeds = {
      rss: "custom-feed.xml",
      atom: "custom-atom.xml",
    };

    const routes: PageRouteInfo[] = [
      {
        patternRelativePath: "post.html",
        templateFilePath: join(config.pagesDir, "post.html"),
        urlPath: "/post",
        outputFilePath: join(config.outDir, "post.html"),
        params: {},
        props: {},
        isDynamic: false,
        feed: {
          title: "Hello",
          description: "World",
          date: "2026-10-01",
        },
      },
    ];

    const rss = generateRss2Xml(routes, config)!;
    const atom = generateAtomXml(routes, config)!;

    expect(rss).toContain('href="https://example.com/custom-feed.xml" rel="self"');
    expect(atom).toContain('href="https://example.com/custom-atom.xml" rel="self"');
  });

  test("VFS ignores .agents directory installed by bustatic init", () => {
    expect(isIgnoredPath(".agents/skills/bustatic/SKILL.md")).toBe(true);
    expect(isIgnoredPath("src/.agents/foo.ts")).toBe(true);
    expect(isIgnoredPath("src/components/my-card.ts")).toBe(false);
  });
});
