import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Builder } from "../src/builder/builder.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-builder-dynamic");

describe("Builder Dynamic Routes & Pagination", () => {
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
      outDir: join(TEST_DIR, "dist"),
      port: 3000,
      minify: false,
      cssStrategy: "inline",
    };
  }

  test("builds dynamic routes with clean URLs and pagination", async () => {
    const config = createTestConfig();
    mkdirSync(config.pagesDir, { recursive: true });
    mkdirSync(join(config.pagesDir, "blog"), { recursive: true });
    mkdirSync(join(config.pagesDir, "catalogo"), { recursive: true });
    mkdirSync(config.dataDir, { recursive: true });

    // Global in-memory dataset
    writeFileSync(
      join(config.dataDir, "posts.ts"),
      `
      export default async function() {
        return [
          { slug: "primer-articulo", title: "Primer Artículo" },
          { slug: "segundo-articulo", title: "Segundo Artículo" }
        ];
      }
      `
    );

    // Static home page
    writeFileSync(join(config.pagesDir, "index.html"), "<h1>Home</h1>");

    // Dynamic blog page
    writeFileSync(
      join(config.pagesDir, "blog/[slug].html"),
      "<h1>{{props.title}}</h1><span>Ruta: {{params.slug}}</span>"
    );
    writeFileSync(
      join(config.pagesDir, "blog/[slug].data.ts"),
      `
      export default async function({ data }: { data: any }) {
        return data.posts.map((post: any) => ({
          params: { slug: post.slug },
          props: { title: post.title }
        }));
      }
      `
    );

    // Dynamic pagination page
    writeFileSync(
      join(config.pagesDir, "catalogo/[page].html"),
      `<h1>Catalogo Pagina {{props.page.currentPage}}</h1>
       <each in="props.page.data">
         <p>{{this}}</p>
       </each>
       <if is="props.page.url.next">
         <a href="{{props.page.url.next}}">Siguiente</a>
       </if>`
    );
    writeFileSync(
      join(config.pagesDir, "catalogo/[page].data.ts"),
      `
      export default async function({ paginate }: { paginate: any }) {
        const items = ["Item A", "Item B", "Item C", "Item D", "Item E"];
        return paginate(items, { pageSize: 2 });
      }
      `
    );

    const builder = new Builder(config);
    const result = await builder.build();

    expect(result.success).toBe(true);
    // 1 (home) + 2 (blog posts) + 3 (catalogo pages: 2+2+1 items = 3 pages) = 6 pages
    expect(result.pagesCount).toBe(6);

    // Verify Clean URL files in dist
    expect(existsSync(join(config.outDir, "index.html"))).toBe(true);

    const post1Path = join(config.outDir, "blog/primer-articulo/index.html");
    const post2Path = join(config.outDir, "blog/segundo-articulo/index.html");
    expect(existsSync(post1Path)).toBe(true);
    expect(existsSync(post2Path)).toBe(true);

    const post1Content = await Bun.file(post1Path).text();
    expect(post1Content).toContain("<h1>Primer Artículo</h1>");
    expect(post1Content).toContain("<span>Ruta: primer-articulo</span>");

    // Verify pagination clean URLs (page 1 is /catalogo/index.html, page 2 is /catalogo/2/index.html)
    const cat1Path = join(config.outDir, "catalogo/index.html");
    const cat2Path = join(config.outDir, "catalogo/2/index.html");
    const cat3Path = join(config.outDir, "catalogo/3/index.html");
    expect(existsSync(cat1Path)).toBe(true);
    expect(existsSync(cat2Path)).toBe(true);
    expect(existsSync(cat3Path)).toBe(true);

    const cat1Content = await Bun.file(cat1Path).text();
    expect(cat1Content).toContain("<h1>Catalogo Pagina 1</h1>");
    expect(cat1Content).toContain("Item A");
    expect(cat1Content).toContain("Item B");
    expect(cat1Content).toContain('href="/catalogo/2"');

    const cat3Content = await Bun.file(cat3Path).text();
    expect(cat3Content).toContain("<h1>Catalogo Pagina 3</h1>");
    expect(cat3Content).toContain("Item E");

    // Verify no staging dir leaked
    expect(existsSync(join(config.root, ".bustatic-staging"))).toBe(false);
  });
});
