import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startDevServer, type DevServerInstance } from "../src/server/dev.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-dev-server-dynamic");

describe("DevServer Dynamic Routes & Assisted 404", () => {
  let devInstance: DevServerInstance | null = null;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (devInstance) {
      devInstance.stop();
      devInstance = null;
    }
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function createTestConfig(port: number): ResolvedConfig {
    return {
      root: TEST_DIR,
      pagesDir: join(TEST_DIR, "pages"),
      layoutsDir: join(TEST_DIR, "layouts"),
      componentsDir: join(TEST_DIR, "components"),
      dataDir: join(TEST_DIR, "data"),
      publicDir: join(TEST_DIR, "public"),
      storageDir: join(TEST_DIR, "storage"),
      cacheDir: join(TEST_DIR, ".bustatic/cache/images"),
      outDir: join(TEST_DIR, "dist"),
      port,
      minify: false,
      cssStrategy: "inline",
    };
  }

  test("serves dynamic routes on-demand and assisted 404 with route list", async () => {
    const port = 34567;
    const config = createTestConfig(port);
    mkdirSync(config.pagesDir, { recursive: true });
    mkdirSync(join(config.pagesDir, "articulos"), { recursive: true });

    // Static page
    writeFileSync(join(config.pagesDir, "index.html"), "<h1>Home Page</h1>");

    // Dynamic route
    writeFileSync(
      join(config.pagesDir, "articulos/[slug].html"),
      "<h1>{{props.titulo}}</h1><p>Slug: {{params.slug}}</p>"
    );
    writeFileSync(
      join(config.pagesDir, "articulos/[slug].data.ts"),
      `
      export default async function() {
        return [
          { params: { slug: "bun-v1" }, props: { titulo: "Lanzamiento Bun v1" } },
          { params: { slug: "bustatic-ssg" }, props: { titulo: "Bustatic SSG Nativo" } }
        ];
      }
      `
    );

    devInstance = startDevServer(config);

    // 1. Fetch static page
    const resHome = await fetch(`http://localhost:${port}/`);
    expect(resHome.status).toBe(200);
    const htmlHome = await resHome.text();
    expect(htmlHome).toContain("<h1>Home Page</h1>");

    // 2. Fetch dynamic route 1
    const resPost1 = await fetch(`http://localhost:${port}/articulos/bun-v1`);
    expect(resPost1.status).toBe(200);
    const htmlPost1 = await resPost1.text();
    expect(htmlPost1).toContain("<h1>Lanzamiento Bun v1</h1>");
    expect(htmlPost1).toContain("<p>Slug: bun-v1</p>");
    expect(htmlPost1).toContain("__bustatic_live_reload");

    // 3. Fetch dynamic route 2
    const resPost2 = await fetch(`http://localhost:${port}/articulos/bustatic-ssg/`);
    expect(resPost2.status).toBe(200);
    const htmlPost2 = await resPost2.text();
    expect(htmlPost2).toContain("<h1>Bustatic SSG Nativo</h1>");

    // 4. Fetch non-existent route -> Assisted 404 with route suggestions
    const resNotFound = await fetch(`http://localhost:${port}/articulos/no-existe`);
    expect(resNotFound.status).toBe(404);
    const htmlNotFound = await resNotFound.text();
    expect(htmlNotFound).toContain("404 - Page Not Found");
    expect(htmlNotFound).toContain("Available routes in this project");
    expect(htmlNotFound).toContain("/articulos/bun-v1");
    expect(htmlNotFound).toContain("/articulos/bustatic-ssg");
  });

  test("serves static page with co-located data loader (.data.ts) providing props and route SEO in dev mode", async () => {
    const port = 34568;
    const config = createTestConfig(port);
    mkdirSync(config.pagesDir, { recursive: true });

    writeFileSync(
      join(config.pagesDir, "index.html"),
      `<!doctype html><html><head><title>Default</title></head><body><h1>{{props.heading}}</h1><ul><each in="props.items"><li>{{name}}</li></each></ul></body></html>`
    );
    writeFileSync(
      join(config.pagesDir, "index.data.ts"),
      `
      export default async function() {
        return {
          props: {
            heading: "Destacados",
            items: [{ name: "Item A" }, { name: "Item B" }],
          },
          seo: {
            title: "Inicio con Loader",
          },
        };
      }
      `
    );

    devInstance = startDevServer(config);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Destacados</h1>");
    expect(html).toContain("<li>Item A</li>");
    expect(html).toContain("<li>Item B</li>");
    expect(html).toContain("<title>Inicio con Loader</title>");
  });
});
