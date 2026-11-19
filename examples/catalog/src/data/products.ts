import { join, dirname } from "node:path";

export interface ProductItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  inStock: boolean;
  featured: boolean;
  releasedAt: string;
  summary: string;
  description: string;
  imageKey: string;
  archiveImageKey: string | null;
  alt: string;
}

/**
 * Global data loader for catalog products.
 * Selects source according to DATA_BACKEND ("local" | "postgres" | "redis").
 */
export default async function loadProducts(): Promise<ProductItem[]> {
  const backend = (process.env.DATA_BACKEND || "local").toLowerCase();

  if (backend === "postgres") {
    const { SQL } = await import("bun");
    const sql = new SQL(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres");
    try {
      const rows = await sql`
        SELECT
          id, slug, name, category, price, currency,
          in_stock AS "inStock", featured, released_at AS "releasedAt",
          summary, description, image_key AS "imageKey",
          archive_image_key AS "archiveImageKey", alt
        FROM catalog_products
        ORDER BY CAST(id AS INTEGER) ASC
      `;
      return rows as unknown as ProductItem[];
    } finally {
      await sql.close();
    }
  }

  if (backend === "redis") {
    const { RedisClient } = await import("bun");
    const redis = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
    try {
      const raw = await redis.get("catalog:products");
      if (!raw) {
        throw new Error(
          "[Catalog Data] Key 'catalog:products' not found in Redis. Please run 'bun scripts/seed.ts --data redis' first."
        );
      }
      return JSON.parse(raw) as ProductItem[];
    } finally {
      redis.close();
    }
  }

  // Local fallback: read fixtures/catalog.json
  const catalogRoot = join(dirname(dirname(import.meta.dir)));
  const fixturePath = join(catalogRoot, "fixtures", "catalog.json");
  const file = Bun.file(fixturePath);
  return (await file.json()) as ProductItem[];
}
