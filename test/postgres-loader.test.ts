import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";
import { Builder } from "../src/builder/builder.ts";
import type { ResolvedConfig } from "../src/types.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-postgres-test");
const POSTGRES_URL =
  process.env.TEST_POSTGRES_URL ||
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/bustatic_test";

/**
 * Checks whether PostgreSQL is reachable before running integration tests.
 */
async function isPostgresAvailable(): Promise<boolean> {
  try {
    const sql = new SQL(POSTGRES_URL);
    await sql`SELECT 1`;
    await sql.close();
    return true;
  } catch {
    return false;
  }
}

describe("Native Bun.sql (PostgreSQL) Integration with Loaders", async () => {
  const available = await isPostgresAvailable();

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

  test.skipIf(!available)(
    "queries real PostgreSQL using Bun.sql, caches in RAM, and builds dynamic routes",
    async () => {
      const sql = new SQL(POSTGRES_URL);

      // 1. Setup real test table
      await sql`DROP TABLE IF EXISTS bustatic_test_posts`;
      await sql`
        CREATE TABLE bustatic_test_posts (
          id SERIAL PRIMARY KEY,
          slug VARCHAR(100) UNIQUE NOT NULL,
          title VARCHAR(200) NOT NULL,
          body TEXT NOT NULL
        )
      `;

      await sql`
        INSERT INTO bustatic_test_posts (slug, title, body) VALUES
        ('bienvenido-bun', 'Bienvenido al ecosistema Bun', 'Bun ejecuta código a velocidad C++ nativa.'),
        ('postgresql-nativo', 'PostgreSQL sin dependencias NPM', 'Bun.sql se comunica directamente con PostgreSQL.')
      `;

      const config = createTestConfig();
      mkdirSync(config.pagesDir, { recursive: true });
      mkdirSync(join(config.pagesDir, "posts"), { recursive: true });
      mkdirSync(config.dataDir, { recursive: true });

      // 2. Global loader in data/posts.ts queries Postgres once into RAM
      writeFileSync(
        join(config.dataDir, "posts.ts"),
        `
        import { SQL } from "bun";

        export default async function() {
          const sql = new SQL(${JSON.stringify(POSTGRES_URL)});
          const rows = await sql\`SELECT slug, title, body FROM bustatic_test_posts ORDER BY id ASC\`;
          await sql.close();
          return rows;
        }
        `
      );

      // 3. Dynamic page consumes posts from RAM ({ data })
      writeFileSync(
        join(config.pagesDir, "posts/[slug].html"),
        "<h1>{{props.post.title}}</h1><article>{{props.post.body}}</article>"
      );
      writeFileSync(
        join(config.pagesDir, "posts/[slug].data.ts"),
        `
        export default async function({ data }: { data: any }) {
          return data.posts.map((post: any) => ({
            params: { slug: post.slug },
            props: { post }
          }));
        }
        `
      );

      const builder = new Builder(config);
      const result = await builder.build();

      expect(result.success).toBe(true);
      expect(result.pagesCount).toBe(2);

      const post1Path = join(config.outDir, "posts/bienvenido-bun/index.html");
      const post2Path = join(config.outDir, "posts/postgresql-nativo/index.html");

      expect(existsSync(post1Path)).toBe(true);
      expect(existsSync(post2Path)).toBe(true);

      const post1Html = await Bun.file(post1Path).text();
      expect(post1Html).toContain("<h1>Bienvenido al ecosistema Bun</h1>");
      expect(post1Html).toContain("<article>Bun ejecuta código a velocidad C++ nativa.</article>");

      // Clean up database table
      await sql`DROP TABLE IF EXISTS bustatic_test_posts`;
      await sql.close();
    }
  );
});
