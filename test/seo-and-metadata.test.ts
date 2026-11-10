import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { SeoMetadataEngine } from "../src/seo/metadata.ts";
import { PhotoProcessor } from "../src/assets/photo-tag.ts";

const tmpDir = join(import.meta.dir, ".tmp-test-seo");

describe("SeoMetadataEngine (<seo> Tag, Social Cards & Canonical)", () => {
  let samplePngBytes: Uint8Array;

  beforeEach(async () => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    mkdirSync(join(tmpDir, "storage"), { recursive: true });
    mkdirSync(join(tmpDir, "public"), { recursive: true });

    // Generate test 100x100 PNG
    const png2x2 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGBgYAAJkBA4Y4dJ8AAAAASUVORK5CYII=",
      "base64"
    );
    const img = new Bun.Image(png2x2);
    const scaled = await img.resize(100, 100);
    const png = await scaled.png();
    samplePngBytes = await png.bytes();

    await Bun.write(join(tmpDir, "public/local-og.png"), samplePngBytes);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("extracts <seo> tag, injects meta into <head> and removes <seo> from body", async () => {
    const config = await resolveConfig(tmpDir, {
      site: {
        url: "https://misitio.com",
        title: "Sitio Base",
        description: "Descripción base",
      },
    });

    const engine = new SeoMetadataEngine(config);

    const inputHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <seo title="Página de Contacto" description="Escríbenos hoy" />
  <h1>Contacto</h1>
</body>
</html>`;

    const result = await engine.processSeo(inputHtml, {
      templatePath: join(tmpDir, "pages/contacto.html"),
      urlPath: "/contacto",
    });

    expect(result).not.toContain("<seo");
    expect(result).toContain("<title>Página de Contacto</title>");
    expect(result).toContain('<meta property="og:title" content="Página de Contacto">');
    expect(result).toContain('<meta property="og:description" content="Escríbenos hoy">');
    expect(result).toContain('<link rel="canonical" href="https://misitio.com/contacto">');
    expect(result).toContain('<meta property="og:url" content="https://misitio.com/contacto">');
    expect(result).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test("cascades metadata: page overrides title and inherits base description", async () => {
    const config = await resolveConfig(tmpDir, {
      site: {
        url: "https://misitio.com",
        title: "Sitio Base",
        description: "Descripción Global de la Empresa",
      },
    });

    const engine = new SeoMetadataEngine(config);

    const inputHtml = `<html><head></head><body><seo title="Acerca de Nosotros" /></body></html>`;

    const result = await engine.processSeo(inputHtml, {
      templatePath: join(tmpDir, "pages/about.html"),
      urlPath: "/about",
    });

    expect(result).toContain("<title>Acerca de Nosotros</title>");
    expect(result).toContain('<meta property="og:title" content="Acerca de Nosotros">');
    // Inherited from config.site
    expect(result).toContain(
      '<meta property="og:description" content="Descripción Global de la Empresa">'
    );
  });

  test("processes remote storage image into social card (1200x630 WebP) with full canonical URL", async () => {
    // Setup storage loader
    const s3Code = `
      export default async function(key: string) {
        return {
          bytes: Buffer.from('${Buffer.from(samplePngBytes).toString("base64")}', 'base64'),
          etag: '"og-v1"'
        };
      }
    `;
    await Bun.write(join(tmpDir, "storage/s3.ts"), s3Code);

    const config = await resolveConfig(tmpDir, {
      site: {
        url: "https://tienda.com",
        title: "Tienda Online",
      },
    });

    const photoProc = new PhotoProcessor(config);
    const engine = new SeoMetadataEngine(config, photoProc.imageProcessor, photoProc.storageManager);

    const inputHtml = `<html><head></head><body><seo title="Producto Top" image-key="products/camisa.png" /></body></html>`;

    const result = await engine.processSeo(inputHtml, {
      templatePath: join(tmpDir, "pages/producto.html"),
      urlPath: "/producto",
    });

    expect(result).toContain('<meta property="og:image" content="https://tienda.com/assets/seo/');
    expect(result).toContain('.webp">');
    expect(result).toContain('<meta property="og:image:width" content="1200">');
    expect(result).toContain('<meta property="og:image:height" content="630">');
    expect(result).toContain('<meta name="twitter:image" content="https://tienda.com/assets/seo/');

    // Emitted assets should have the social card
    expect(engine.emittedAssets.size).toBe(1);
    const [asset] = Array.from(engine.emittedAssets.values());
    expect(asset.outputPath).toStartWith("assets/seo/");
    expect(asset.bytes.length).toBeGreaterThan(0);
  });

  test("supports route.seo from dynamic loader", async () => {
    const config = await resolveConfig(tmpDir, {
      site: {
        url: "https://blog.com",
      },
    });

    const engine = new SeoMetadataEngine(config);

    const inputHtml = `<html><head></head><body><h1>Post</h1></body></html>`;

    const result = await engine.processSeo(inputHtml, {
      templatePath: join(tmpDir, "pages/blog/[slug].html"),
      urlPath: "/blog/mi-post",
      routeSeo: {
        title: "Mi Primer Post",
        description: "Contenido del post",
        image: "/local-og.png",
      },
    });

    expect(result).toContain("<title>Mi Primer Post</title>");
    expect(result).toContain('<meta property="og:title" content="Mi Primer Post">');
    expect(result).toContain('<meta property="og:description" content="Contenido del post">');
    expect(result).toContain('<meta property="og:image" content="https://blog.com/assets/seo/');
    expect(result).toContain('<link rel="canonical" href="https://blog.com/blog/mi-post">');
  });
});
