import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  extractRouteTokens,
  isDynamicPattern,
  createPaginator,
  buildCleanUrl,
  validateRouteParams,
  resolveAllRoutes,
} from "../src/router/routes.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-dynamic-routes");

describe("Dynamic Router & Pagination System", () => {
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

  function createTestConfig(): ResolvedConfig {
    return {
      root: TEST_DIR,
      pagesDir: join(TEST_DIR, "pages"),
      layoutsDir: join(TEST_DIR, "layouts"),
      componentsDir: join(TEST_DIR, "components"),
      dataDir: join(TEST_DIR, "data"),
      publicDir: join(TEST_DIR, "public"),
      storageDir: join(TEST_DIR, "storage"),
      cacheDir: join(TEST_DIR, ".buntic/cache/images"),
      outDir: join(TEST_DIR, "dist"),
      port: 3000,
      minify: false,
      cssStrategy: "inline",
    };
  }

  describe("Pattern Parsing & URL Construction", () => {
    test("extracts parameter tokens correctly", () => {
      expect(extractRouteTokens("index.html")).toEqual([]);
      expect(extractRouteTokens("blog/[slug].html")).toEqual(["slug"]);
      expect(extractRouteTokens("[categoria]/[producto].html")).toEqual(["categoria", "producto"]);
      expect(isDynamicPattern("blog/[slug].html")).toBe(true);
      expect(isDynamicPattern("about.html")).toBe(false);
    });

    test("builds clean URLs and paths for static pages", () => {
      const idx = buildCleanUrl("index.html", {});
      expect(idx.urlPath).toBe("/");
      expect(idx.relOutputPath).toBe("index.html");

      const about = buildCleanUrl("about.html", {});
      expect(about.urlPath).toBe("/about");
      expect(about.relOutputPath).toBe("about.html");

      const nested = buildCleanUrl("docs/install.html", {});
      expect(nested.urlPath).toBe("/docs/install");
      expect(nested.relOutputPath).toBe("docs/install.html");
    });

    test("builds clean URLs for dynamic routes and handles page 1 omission", () => {
      // Regular dynamic route
      const post = buildCleanUrl("blog/[slug].html", { slug: "mi-articulo" });
      expect(post.urlPath).toBe("/blog/mi-articulo");
      expect(post.relOutputPath).toBe("blog/mi-articulo/index.html");

      // Pagination page 1 -> canonical root
      const page1 = buildCleanUrl("catalogo/[page].html", { page: "1" });
      expect(page1.urlPath).toBe("/catalogo");
      expect(page1.relOutputPath).toBe("catalogo/index.html");

      // Pagination page 2 -> numbered subfolder
      const page2 = buildCleanUrl("catalogo/[page].html", { page: "2" });
      expect(page2.urlPath).toBe("/catalogo/2");
      expect(page2.relOutputPath).toBe("catalogo/2/index.html");

      // Root pagination [page].html
      const rootP1 = buildCleanUrl("[page].html", { page: "1" });
      expect(rootP1.urlPath).toBe("/");
      expect(rootP1.relOutputPath).toBe("index.html");

      const rootP2 = buildCleanUrl("[page].html", { page: "2" });
      expect(rootP2.urlPath).toBe("/2");
      expect(rootP2.relOutputPath).toBe("2/index.html");
    });
  });

  describe("Declarative Pagination Helper (paginate)", () => {
    test("segments array into pages and sets canonical navigation URLs", () => {
      const items = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));
      const paginator = createPaginator("/catalogo");

      const pages = paginator(items, { pageSize: 10, props: { category: "General" } });

      expect(pages.length).toBe(3);

      // Page 1
      expect(pages[0].params.page).toBe("1");
      expect(pages[0].props?.category).toBe("General");
      expect(pages[0].props?.page.data.length).toBe(10);
      expect(pages[0].props?.page.currentPage).toBe(1);
      expect(pages[0].props?.page.lastPage).toBe(3);
      expect(pages[0].props?.page.url.current).toBe("/catalogo");
      expect(pages[0].props?.page.url.prev).toBeNull();
      expect(pages[0].props?.page.url.next).toBe("/catalogo/2");

      // Page 2
      expect(pages[1].params.page).toBe("2");
      expect(pages[1].props?.page.currentPage).toBe(2);
      expect(pages[1].props?.page.url.current).toBe("/catalogo/2");
      expect(pages[1].props?.page.url.prev).toBe("/catalogo"); // Points to canonical clean root
      expect(pages[1].props?.page.url.next).toBe("/catalogo/3");

      // Page 3 (last page with remaining 5 items)
      expect(pages[2].params.page).toBe("3");
      expect(pages[2].props?.page.data.length).toBe(5);
      expect(pages[2].props?.page.currentPage).toBe(3);
      expect(pages[2].props?.page.url.current).toBe("/catalogo/3");
      expect(pages[2].props?.page.url.prev).toBe("/catalogo/2");
      expect(pages[2].props?.page.url.next).toBeNull();
    });
  });

  describe("Parameter Validation & Security", () => {
    test("rejects missing, empty, or malicious parameter values", () => {
      expect(() => validateRouteParams(["slug"], {}, "test.data.ts")).toThrow(
        /Missing required route parameter "slug"/
      );

      expect(() => validateRouteParams(["slug"], { slug: "  " }, "test.data.ts")).toThrow(
        /cannot be an empty string/
      );

      expect(() => validateRouteParams(["slug"], { slug: "../escape" }, "test.data.ts")).toThrow(
        /contains invalid characters/
      );

      expect(() => validateRouteParams(["slug"], { slug: "post?query=1" }, "test.data.ts")).toThrow(
        /contains invalid characters/
      );

      expect(() => validateRouteParams(["slug"], { slug: "post#hash" }, "test.data.ts")).toThrow(
        /contains invalid characters/
      );

      // Valid param
      const valid = validateRouteParams(["slug"], { slug: "articulo-100" }, "test.data.ts");
      expect(valid.slug).toBe("articulo-100");
    });
  });

  describe("resolveAllRoutes Integration", () => {
    test("throws actionable error when a dynamic page lacks a co-located loader", async () => {
      const config = createTestConfig();
      mkdirSync(join(config.pagesDir, "blog"), { recursive: true });

      // Create [slug].html without [slug].data.ts
      writeFileSync(join(config.pagesDir, "blog/[slug].html"), "<h1>{{props.title}}</h1>");

      await expect(resolveAllRoutes(config, {})).rejects.toThrow(
        /requires a co-located loader|no co-located loader was found/
      );
    });

    test("detects URL collisions and throws actionable error", async () => {
      const config = createTestConfig();
      mkdirSync(join(config.pagesDir, "blog"), { recursive: true });

      writeFileSync(join(config.pagesDir, "blog/[slug].html"), "<h1>Post</h1>");
      writeFileSync(
        join(config.pagesDir, "blog/[slug].data.ts"),
        `
        export default async function() {
          return [
            { params: { slug: "mismo-slug" }, props: { title: "Primero" } },
            { params: { slug: "mismo-slug" }, props: { title: "Segundo" } }
          ];
        }
        `
      );

      await expect(resolveAllRoutes(config, {})).rejects.toThrow(
        /\[Buntic Collision Error\]: Duplicate route generated for "\/blog\/mismo-slug"/
      );
    });

    test("resolves both static and dynamic routes with RAM data injection", async () => {
      const config = createTestConfig();
      mkdirSync(join(config.pagesDir, "productos"), { recursive: true });

      // Static page
      writeFileSync(join(config.pagesDir, "index.html"), "<h1>Inicio</h1>");

      // Dynamic page
      writeFileSync(
        join(config.pagesDir, "productos/[id].html"),
        "<h1>{{props.name}}</h1>"
      );
      writeFileSync(
        join(config.pagesDir, "productos/[id].data.ts"),
        `
        export default async function({ data }: { data: any }) {
          return data.catalog.map((item: any) => ({
            params: { id: item.id },
            props: { name: item.name }
          }));
        }
        `
      );

      const globalData = {
        catalog: [
          { id: "101", name: "Teclado Mecánico" },
          { id: "102", name: "Mouse Inalámbrico" },
        ],
      };

      const routes = await resolveAllRoutes(config, globalData);

      expect(routes.length).toBe(3);

      const home = routes.find((r) => r.urlPath === "/");
      expect(home).toBeDefined();
      expect(home?.isDynamic).toBe(false);

      const prod1 = routes.find((r) => r.urlPath === "/productos/101");
      expect(prod1).toBeDefined();
      expect(prod1?.params.id).toBe("101");
      expect(prod1?.props.name).toBe("Teclado Mecánico");
      expect(prod1?.outputFilePath).toBe(join(config.outDir, "productos/101/index.html"));

      const prod2 = routes.find((r) => r.urlPath === "/productos/102");
      expect(prod2).toBeDefined();
      expect(prod2?.params.id).toBe("102");
      expect(prod2?.outputFilePath).toBe(join(config.outDir, "productos/102/index.html"));
    });
  });
});
