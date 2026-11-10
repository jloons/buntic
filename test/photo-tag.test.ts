import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { PhotoProcessor } from "../src/assets/photo-tag.ts";
import { resolveConfig } from "../src/config.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-photo");

describe("PhotoProcessor (<photo> Tag & WebP Optimization)", () => {
  let samplePngBytes: Uint8Array;

  beforeEach(async () => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    mkdirSync(join(tmpDir, "public"), { recursive: true });

    // Generate a clean 100x100 test PNG
    const png2x2 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGBgYAAJkBA4Y4dJ8AAAAASUVORK5CYII=",
      "base64"
    );
    const img = new Bun.Image(png2x2);
    const scaled = await img.resize(100, 100);
    const png = await scaled.png();
    samplePngBytes = await png.bytes();

    await Bun.write(join(tmpDir, "public/hero.png"), samplePngBytes);
    await Bun.write(join(tmpDir, "pages/avatar.png"), samplePngBytes);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("processes local image into WebP with anti-CLS width and height", async () => {
    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    const inputHtml = `<main><photo src="/hero.png" alt="Hero banner" class="banner"></photo></main>`;

    const outputHtml = await processor.processHtml(inputHtml, templatePath);

    expect(outputHtml).not.toContain("<photo");
    expect(outputHtml).toContain("<img src=\"/assets/images/");
    expect(outputHtml).toContain(".webp\"");
    expect(outputHtml).toContain('width="100"');
    expect(outputHtml).toContain('height="100"');
    expect(outputHtml).toContain('loading="lazy"');
    expect(outputHtml).toContain('decoding="async"');
    expect(outputHtml).toContain('alt="Hero banner"');
    expect(outputHtml).toContain('class="banner"');

    // Emitted assets map should contain the WebP
    expect(processor.emittedAssets.size).toBe(1);
    const [asset] = Array.from(processor.emittedAssets.values());
    expect(asset.outputPath).toStartWith("assets/images/");
    expect(asset.outputPath).toEndWith(".webp");
    expect(asset.bytes.length).toBeGreaterThan(0);
  });

  test("respects user loading='eager' and custom dimensions", async () => {
    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    const inputHtml = `<photo src="/hero.png" alt="Hero" loading="eager" width="50" height="50" />`;

    const outputHtml = await processor.processHtml(inputHtml, templatePath);

    expect(outputHtml).toContain('loading="eager"');
    expect(outputHtml).toContain('width="50"');
    expect(outputHtml).toContain('height="50"');
  });

  test("generates multi-width srcset and sizes when widths is specified", async () => {
    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    const inputHtml = `<photo src="/hero.png" widths="30,60,90" sizes="(min-width: 600px) 50vw, 100vw" alt="Responsive" />`;

    const outputHtml = await processor.processHtml(inputHtml, templatePath);

    expect(outputHtml).toContain("srcset=");
    expect(outputHtml).toContain("30w");
    expect(outputHtml).toContain("60w");
    expect(outputHtml).toContain("90w");
    expect(outputHtml).toContain('sizes="(min-width: 600px) 50vw, 100vw"');

    // Should emit 3 variants
    expect(processor.emittedAssets.size).toBe(3);
  });

  test("ignores widths larger than original image to avoid upscaling", async () => {
    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    // Original is 100x100; widths="50, 500" -> 500 should be ignored
    const inputHtml = `<photo src="/hero.png" widths="50,500" alt="Responsive" />`;

    const outputHtml = await processor.processHtml(inputHtml, templatePath);

    expect(outputHtml).not.toContain("500w");
    expect(outputHtml).toContain("50w");
    expect(processor.emittedAssets.size).toBe(1);
  });

  test("throws actionable error if neither src nor key is provided", async () => {
    const config = await resolveConfig(tmpDir);
    const processor = new PhotoProcessor(config);

    const templatePath = join(tmpDir, "pages/index.html");
    const inputHtml = `<photo alt="Missing src" />`;

    expect(processor.processHtml(inputHtml, templatePath)).rejects.toThrow(
      '<photo> tag must have a "src" (for local files) or a "key" (for remote storage)'
    );
  });
});
