import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { StorageManager } from "../src/storage/loader.ts";
import { PhotoProcessor } from "../src/assets/photo-tag.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-storage");

describe("StorageManager & Persistent ETag Cache", () => {
  let samplePngBytes: Uint8Array;

  beforeEach(async () => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    mkdirSync(join(tmpDir, "storage"), { recursive: true });

    const png2x2 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGBgYAAJkBA4Y4dJ8AAAAASUVORK5CYII=",
      "base64"
    );
    const img = new Bun.Image(png2x2);
    const scaled = await img.resize(80, 80);
    const png = await scaled.png();
    samplePngBytes = await png.bytes();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("auto-detects single storage loader as default", async () => {
    // Write storage/s3.ts
    const s3LoaderCode = `
      export default async function(key: string) {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          etag: '"test-etag-1"',
          contentType: 'image/png'
        };
      }
    `;
    await Bun.write(join(tmpDir, "storage/s3.ts"), s3LoaderCode);

    const config = await resolveConfig(tmpDir);
    const manager = new StorageManager(config);
    await manager.init();

    expect(manager.getAvailableStorages()).toEqual(["s3"]);
    expect(manager.getDefaultStorageName()).toBe("s3");

    const asset = await manager.fetchAsset("banners/promo.png");
    expect(asset.etag).toBe('"test-etag-1"');
    expect(asset.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("enforces storage attribute when multiple loaders exist and no default is set", async () => {
    await Bun.write(
      join(tmpDir, "storage/s3.ts"),
      `export default async function(k: string) { return new Uint8Array([1]); }`
    );
    await Bun.write(
      join(tmpDir, "storage/r2.ts"),
      `export default async function(k: string) { return new Uint8Array([2]); }`
    );

    const config = await resolveConfig(tmpDir);
    const manager = new StorageManager(config);
    await manager.init();

    expect(manager.getAvailableStorages().sort()).toEqual(["r2", "s3"]);
    expect(manager.getDefaultStorageName()).toBeUndefined();

    // Fetching without specifying storage should throw actionable error
    expect(manager.fetchAsset("test.png")).rejects.toThrow(
      "Multiple storage loaders detected"
    );

    // Fetching with explicit storage succeeds
    const s3Asset = await manager.fetchAsset("test.png", "s3");
    expect(s3Asset.bytes).toEqual(new Uint8Array([1]));

    const r2Asset = await manager.fetchAsset("test.png", "r2");
    expect(r2Asset.bytes).toEqual(new Uint8Array([2]));
  });

  test("uses persistent cache with ETag and re-fetches when ETag changes", async () => {
    // Global counter to track how many times the loader was invoked
    let fetchCount = 0;
    let currentEtag = '"etag-version-1"';

    const storageLoaderCode = `
      let count = 0;
      export default async function(key: string) {
        count++;
        // Write count to a temp status file so test can read it
        return {
          bytes: Buffer.from('${Buffer.from(samplePngBytes).toString("base64")}', 'base64'),
          etag: process.env.TEST_ETAG || '"etag-version-1"'
        };
      }
    `;
    await Bun.write(join(tmpDir, "storage/s3.ts"), storageLoaderCode);

    process.env.TEST_ETAG = '"etag-v1"';

    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    const html = `<photo key="products/shoe.jpg" alt="Shoe" />`;

    // 1st render: processes with Bun.Image and caches
    const output1 = await processor.processHtml(html, templatePath);
    expect(output1).toContain("<img src=\"/assets/images/");
    expect(output1).toContain(".webp\"");

    const diskCacheDir = join(tmpDir, ".buntic/cache/images/s3");
    expect(existsSync(diskCacheDir)).toBe(true);

    // 2nd render: fresh processor instance (simulating next build), same ETag
    const processor2 = new PhotoProcessor(config);
    const output2 = await processor2.processHtml(html, templatePath);
    expect(output2).toBe(output1);

    // 3rd render: ETag changes, cache should generate new variant
    process.env.TEST_ETAG = '"etag-v2"';
    const processor3 = new PhotoProcessor(config);
    const output3 = await processor3.processHtml(html, templatePath);

    // The output URL should have a different hash because the ETag changed!
    expect(output3).not.toBe(output1);
  });
});
