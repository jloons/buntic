import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseEnvContent, loadPublicEnv, isReservedNamespace } from "../src/env.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-global-data-env");

describe("Environment Variables & In-Memory Global Data Store", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function createTestConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
    return {
      root: TEST_DIR,
      pagesDir: join(TEST_DIR, "pages"),
      layoutsDir: join(TEST_DIR, "layouts"),
      componentsDir: join(TEST_DIR, "components"),
      dataDir: join(TEST_DIR, "data"),
      publicDir: join(TEST_DIR, "public"),
      outDir: join(TEST_DIR, "dist"),
      port: 3000,
      minify: false,
      cssStrategy: "inline",
      ...overrides,
    };
  }

  describe("Public Environment Parser & Filter", () => {
    test("parses .env content accurately with comments, quotes and spaces", () => {
      const raw = `
        # Comment line
        PUBLIC_SITE_NAME = "Bustatic Blog"
        PUBLIC_API_URL='https://api.example.com'
        EMPTY_VAR=
        # Another comment
        QUOTED_MULTILINE="Line 1\\nLine 2"
      `;
      const parsed = parseEnvContent(raw);
      expect(parsed.PUBLIC_SITE_NAME).toBe("Bustatic Blog");
      expect(parsed.PUBLIC_API_URL).toBe("https://api.example.com");
      expect(parsed.QUOTED_MULTILINE).toBe("Line 1\nLine 2");
      expect(parsed.EMPTY_VAR).toBe("");
    });

    test("loads .env.public and PUBLIC_* variables while protecting private secrets", () => {
      // Create .env.public in test root
      writeFileSync(
        join(TEST_DIR, ".env.public"),
        "PUBLIC_SITE_TITLE=Awesome Site\nPUBLIC_CDN=https://cdn.example.com\n"
      );

      // Set environment variables in process.env
      process.env.PUBLIC_ANALYTICS_ID = "UA-123456";
      process.env.DATABASE_URL = "postgres://secret:password@localhost:5432/db";
      process.env.SECRET_API_KEY = "super-secret-key";

      const publicEnv = loadPublicEnv(TEST_DIR);

      // Verify public values are present
      expect(publicEnv.PUBLIC_SITE_TITLE).toBe("Awesome Site");
      expect(publicEnv.PUBLIC_CDN).toBe("https://cdn.example.com");
      expect(publicEnv.PUBLIC_ANALYTICS_ID).toBe("UA-123456");

      // Verify private secrets are NEVER exposed
      expect(publicEnv.DATABASE_URL).toBeUndefined();
      expect(publicEnv.SECRET_API_KEY).toBeUndefined();

      // Clean up process.env
      delete process.env.PUBLIC_ANALYTICS_ID;
      delete process.env.DATABASE_URL;
      delete process.env.SECRET_API_KEY;
    });

    test("recognizes reserved namespaces (params, props, env)", () => {
      expect(isReservedNamespace("params")).toBe(true);
      expect(isReservedNamespace("props")).toBe(true);
      expect(isReservedNamespace("env")).toBe(true);
      expect(isReservedNamespace("articles")).toBe(false);
      expect(isReservedNamespace("site")).toBe(false);
    });
  });

  describe("Global In-Memory Data Store (data/*.ts and data/*.json)", () => {
    test("loads static JSON and async TypeScript loaders into RAM once", async () => {
      const dataDir = join(TEST_DIR, "data");
      mkdirSync(dataDir, { recursive: true });

      // 1. Static JSON
      writeFileSync(join(dataDir, "site.json"), JSON.stringify({ name: "Bustatic Site", author: "Bun Team" }));

      // 2. Async TypeScript loader with execution counter
      let executionCount = 0;
      (globalThis as any).__testExecutionCount = 0;

      writeFileSync(
        join(dataDir, "articles.ts"),
        `
        export default async function({ env }: { env: Record<string, string> }) {
          (globalThis as any).__testExecutionCount = ((globalThis as any).__testExecutionCount || 0) + 1;
          return [
            { id: 1, title: "Primer Post", slug: "primer-post" },
            { id: 2, title: "Segundo Post", slug: "segundo-post" }
          ];
        }
        `
      );

      const engine = new TemplateEngine(createTestConfig());

      // First call: executes loaders and caches in RAM
      const data1 = await engine.loadData();
      expect(data1.site.name).toBe("Bustatic Site");
      expect(data1.articles.length).toBe(2);
      expect(data1.articles[0].title).toBe("Primer Post");
      expect((globalThis as any).__testExecutionCount).toBe(1);

      // Second call: must read from RAM cache, NOT re-executing loader
      const data2 = await engine.loadData();
      expect(data2).toBe(data1); // Same object reference in memory
      expect((globalThis as any).__testExecutionCount).toBe(1);

      // After cache invalidation: re-executes
      engine.invalidateDataCache();
      const data3 = await engine.loadData();
      expect((globalThis as any).__testExecutionCount).toBe(2);

      delete (globalThis as any).__testExecutionCount;
    });

    test("warns and skips data files named with reserved namespaces", async () => {
      const dataDir = join(TEST_DIR, "data");
      mkdirSync(dataDir, { recursive: true });

      writeFileSync(join(dataDir, "params.json"), JSON.stringify({ fake: "param" }));
      writeFileSync(join(dataDir, "props.ts"), "export default () => ({ fake: 'prop' });");

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => warnings.push(args.join(" "));

      try {
        const engine = new TemplateEngine(createTestConfig());
        const data = await engine.loadData();

        expect(warnings.some((w) => w.includes('conflicts with reserved namespace "params"'))).toBe(true);
        expect(warnings.some((w) => w.includes('conflicts with reserved namespace "props"'))).toBe(true);
        expect(data.params).toBeUndefined();
        expect(data.props).toBeUndefined();
      } finally {
        console.warn = origWarn;
      }
    });

    test("interpolates public env, global data, and pageContext (params & props) without collisions", async () => {
      const dataDir = join(TEST_DIR, "data");
      mkdirSync(dataDir, { recursive: true });

      writeFileSync(join(dataDir, "site.json"), JSON.stringify({ name: "Bustatic Docs" }));
      writeFileSync(
        join(TEST_DIR, ".env.public"),
        "PUBLIC_API=https://api.bustatic.dev\n"
      );

      const engine = new TemplateEngine(createTestConfig());

      const pageHtml = `
        <h1>{{site.name}}</h1>
        <p>API: {{env.PUBLIC_API}}</p>
        <h2>{{props.article.title}}</h2>
        <span>Slug: {{params.slug}}</span>
      `;

      const rendered = await engine.renderPage(pageHtml, join(TEST_DIR, "pages/blog/[slug].html"), {
        params: { slug: "mi-primer-post" },
        props: {
          article: { title: "Introducción a Bustatic", author: "Dev" },
        },
      });

      expect(rendered).toContain("<h1>Bustatic Docs</h1>");
      expect(rendered).toContain("<p>API: https://api.bustatic.dev</p>");
      expect(rendered).toContain("<h2>Introducción a Bustatic</h2>");
      expect(rendered).toContain("<span>Slug: mi-primer-post</span>");
    });
  });
});
