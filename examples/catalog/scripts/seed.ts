import { join, dirname } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { SQL, RedisClient, S3Client } from "bun";
import { OrasClient } from "../../../src/index.ts";

const catalogDir = dirname(import.meta.dir);
const fixturesDir = join(catalogDir, "fixtures");
const catalogJsonPath = join(fixturesDir, "catalog.json");
const imagesDir = join(fixturesDir, "images");

interface SeedOptions {
  dataBackend?: string;
  storageBackend?: string;
}

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  let dataBackend = "all";
  let storageBackend = "all";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data" && args[i + 1]) {
      dataBackend = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === "--storage" && args[i + 1]) {
      storageBackend = args[i + 1].toLowerCase();
      i++;
    }
  }

  return { dataBackend, storageBackend };
}

async function seedPostgres(catalog: any[]) {
  const url = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
  console.log(`🐘 [Seed] Connecting to PostgreSQL at ${url}...`);
  const sql = new SQL(url);

  try {
    await sql`DROP TABLE IF EXISTS catalog_products`;
    await sql`
      CREATE TABLE catalog_products (
        id VARCHAR(50) PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        in_stock BOOLEAN NOT NULL,
        featured BOOLEAN NOT NULL,
        released_at VARCHAR(50) NOT NULL,
        summary TEXT NOT NULL,
        description TEXT NOT NULL,
        image_key VARCHAR(200) NOT NULL,
        archive_image_key VARCHAR(200),
        alt TEXT NOT NULL
      )
    `;

    for (const item of catalog) {
      await sql`
        INSERT INTO catalog_products (
          id, slug, name, category, price, currency,
          in_stock, featured, released_at, summary,
          description, image_key, archive_image_key, alt
        ) VALUES (
          ${item.id}, ${item.slug}, ${item.name}, ${item.category},
          ${item.price}, ${item.currency}, ${item.inStock}, ${item.featured},
          ${item.releasedAt}, ${item.summary}, ${item.description},
          ${item.imageKey}, ${item.archiveImageKey}, ${item.alt}
        )
      `;
    }

    console.log(`✔ [Seed] Inserted ${catalog.length} products into PostgreSQL.`);
  } finally {
    await sql.close();
  }
}

async function seedRedis(catalog: any[]) {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  console.log(`🔴 [Seed] Connecting to Redis at ${url}...`);
  const redis = new RedisClient(url);

  try {
    await redis.set("catalog:products", JSON.stringify(catalog));
    for (const item of catalog) {
      await redis.set(`catalog:product:${item.slug}`, JSON.stringify(item));
    }
    console.log(`✔ [Seed] Saved catalog and ${catalog.length} product keys into Redis.`);
  } finally {
    redis.close();
  }
}

function findFixtureImageFiles(): Array<{ targetKey: string; filePath: string }> {
  const results: Array<{ targetKey: string; filePath: string }> = [];
  const productDir = join(imagesDir, "product");

  if (!existsSync(productDir)) return results;

  const idDirs = readdirSync(productDir);
  for (const id of idDirs) {
    const portraitDir = join(productDir, id, "portrait");
    if (!existsSync(portraitDir)) continue;

    const files = readdirSync(portraitDir);
    for (const f of files) {
      const extIdx = f.lastIndexOf(".");
      const tag = extIdx !== -1 ? f.slice(0, extIdx) : f;
      results.push({
        targetKey: `product/${id}/portrait:${tag}`,
        filePath: join(portraitDir, f),
      });
    }
  }

  return results;
}

async function seedOciRegistry(images: Array<{ targetKey: string; filePath: string }>) {
  const host = process.env.OCI_REGISTRY_HOST || "localhost:5000";
  console.log(`📦 [Seed] Pushing OCI artifacts to Registry at ${host}...`);
  const client = new OrasClient({
    hostname: host,
    insecure: true,
  });

  for (const img of images) {
    const target = `${host}/${img.targetKey}`;
    await client.push({
      target,
      files: [img.filePath],
      manifestAnnotations: {
        "org.opencontainers.image.description": `Bustatic catalog image for ${img.targetKey}`,
      },
    });
    console.log(`  ✔ Pushed OCI artifact: ${target}`);
  }

  console.log(`✔ [Seed] Pushed all ${images.length} image artifacts to OCI Registry.`);
}

async function seedS3(images: Array<{ targetKey: string; filePath: string }>) {
  const bucket = process.env.S3_BUCKET || "catalog";
  const endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
  console.log(`🪣 [Seed] Uploading objects to S3 bucket "${bucket}" at ${endpoint}...`);

  const s3 = new S3Client({
    bucket,
    endpoint,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "testkey",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "testsecret",
  });

  for (const img of images) {
    const file = Bun.file(img.filePath);
    const s3Key = img.targetKey.replace(":", "/");
    await s3.write(s3Key, file);
    console.log(`  ✔ Uploaded S3 object: ${s3Key}`);
  }

  console.log(`✔ [Seed] Uploaded all ${images.length} objects to S3.`);
}

async function main() {
  const { dataBackend, storageBackend } = parseArgs();
  const catalog = await Bun.file(catalogJsonPath).json();
  const images = findFixtureImageFiles();

  console.log(`\n🌱 [Seed] Preparing test data (${catalog.length} products, ${images.length} images)...`);

  // Data Seeding
  if (dataBackend === "all" || dataBackend === "postgres") {
    try {
      await seedPostgres(catalog);
    } catch (err: any) {
      console.error(`❌ [Seed] PostgreSQL error: ${err.message}`);
      if (dataBackend === "postgres") process.exit(1);
    }
  }

  if (dataBackend === "all" || dataBackend === "redis") {
    try {
      await seedRedis(catalog);
    } catch (err: any) {
      console.error(`❌ [Seed] Redis error: ${err.message}`);
      if (dataBackend === "redis") process.exit(1);
    }
  }

  // Storage Seeding
  if (storageBackend === "all" || storageBackend === "oci") {
    try {
      await seedOciRegistry(images);
    } catch (err: any) {
      console.error(`❌ [Seed] OCI Registry error: ${err.message}`);
      if (storageBackend === "oci") process.exit(1);
    }
  }

  if (storageBackend === "all" || storageBackend === "s3") {
    try {
      await seedS3(images);
    } catch (err: any) {
      console.error(`❌ [Seed] S3 error: ${err.message}`);
      if (storageBackend === "s3") process.exit(1);
    }
  }

  console.log(`✨ [Seed] Completed successfully!\n`);
}

main().catch((err) => {
  console.error("Fatal seed error:", err);
  process.exit(1);
});
