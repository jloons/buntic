import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Builder } from "../src/builder/builder.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-sqlite-test");

describe("Native bun:sqlite Integration with Loaders", () => {
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
      cacheDir: join(TEST_DIR, ".bustatic/cache/images"),
      outDir: join(TEST_DIR, "dist"),
      port: 3000,
      minify: false,
      cssStrategy: "inline",
    };
  }

  test("queries SQLite database inside global data loader and builds dynamic pages", async () => {
    const config = createTestConfig();
    mkdirSync(config.pagesDir, { recursive: true });
    mkdirSync(join(config.pagesDir, "productos"), { recursive: true });
    mkdirSync(config.dataDir, { recursive: true });

    // 1. Seed SQLite database file
    const dbPath = join(TEST_DIR, "catalog.sqlite");
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL
      )
    `);

    const insert = db.prepare("INSERT INTO products (slug, name, price) VALUES (?, ?, ?)");
    insert.run("auriculares-pro", "Auriculares Pro Inalámbricos", 149.99);
    insert.run("teclado-mecanico", "Teclado Mecánico RGB", 89.5);
    insert.run("monitor-4k", "Monitor 4K Ultra HD", 399.0);
    db.close();

    // 2. Global loader in data/products.ts queries SQLite once into RAM
    writeFileSync(
      join(config.dataDir, "products.ts"),
      `
      import { Database } from "bun:sqlite";
      import { join } from "node:path";

      export default async function() {
        const db = new Database(${JSON.stringify(dbPath)});
        const query = db.query("SELECT slug, name, price FROM products ORDER BY id ASC");
        const rows = query.all();
        db.close();
        return rows;
      }
      `
    );

    // 3. Dynamic page consumes products from RAM ({ data })
    writeFileSync(
      join(config.pagesDir, "productos/[slug].html"),
      "<h1>{{props.product.name}}</h1><p>Precio: \${{props.product.price}}</p>"
    );
    writeFileSync(
      join(config.pagesDir, "productos/[slug].data.ts"),
      `
      export default async function({ data }: { data: any }) {
        // data.products was fetched once from SQLite into RAM
        return data.products.map((item: any) => ({
          params: { slug: item.slug },
          props: { product: item }
        }));
      }
      `
    );

    const builder = new Builder(config);
    const result = await builder.build();

    expect(result.success).toBe(true);
    expect(result.pagesCount).toBe(3);

    // Verify all 3 pages were generated from SQLite
    const p1Path = join(config.outDir, "productos/auriculares-pro/index.html");
    const p2Path = join(config.outDir, "productos/teclado-mecanico/index.html");
    const p3Path = join(config.outDir, "productos/monitor-4k/index.html");

    expect(existsSync(p1Path)).toBe(true);
    expect(existsSync(p2Path)).toBe(true);
    expect(existsSync(p3Path)).toBe(true);

    const p1Html = await Bun.file(p1Path).text();
    expect(p1Html).toContain("<h1>Auriculares Pro Inalámbricos</h1>");
    expect(p1Html).toContain("<p>Precio: $149.99</p>");

    const p2Html = await Bun.file(p2Path).text();
    expect(p2Html).toContain("<h1>Teclado Mecánico RGB</h1>");
    expect(p2Html).toContain("<p>Precio: $89.5</p>");
  });
});
