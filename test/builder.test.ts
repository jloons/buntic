import { describe, test, expect } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import { Builder } from "../src/builder/builder.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

describe("Builder", () => {
  test("builds the simple example project successfully with src layout", async () => {
    const exampleDir = join(import.meta.dir, "../examples/simple");
    const outDir = join(exampleDir, "dist");

    // Clean any previous dist
    if (existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }

    const config = await resolveConfig(exampleDir);
    const builder = new Builder(config);
    const result = await builder.build();

    expect(result.success).toBe(true);
    expect(result.pagesCount).toBe(3);

    // Verify generated HTML pages
    const indexHtmlPath = join(outDir, "index.html");
    const aboutHtmlPath = join(outDir, "about.html");
    const contactHtmlPath = join(outDir, "contact.html");
    expect(existsSync(indexHtmlPath)).toBe(true);
    expect(existsSync(aboutHtmlPath)).toBe(true);
    expect(existsSync(contactHtmlPath)).toBe(true);

    const indexHtml = await Bun.file(indexHtmlPath).text();
    expect(indexHtml).toContain("Inicio | Buntic Simple");
    expect(indexHtml).toContain("Características Principales");
    expect(indexHtml).toContain("feature-card");
    expect(indexHtml).toContain("Buntic Simple");

    const aboutHtml = await Bun.file(aboutHtmlPath).text();
    expect(aboutHtml).toContain("Acerca de este proyecto");
    expect(aboutHtml).toContain("cero JavaScript");

    const contactHtml = await Bun.file(contactHtmlPath).text();
    expect(contactHtml).toContain("Contacto");
    expect(contactHtml).toContain("contacto@example.com");

    // Verify robots.txt and buntic-icon.svg from public/ copied to dist/
    const robotsPath = join(outDir, "robots.txt");
    expect(existsSync(robotsPath)).toBe(true);
    const iconPath = join(outDir, "buntic-icon.svg");
    expect(existsSync(iconPath)).toBe(true);

    // In default inline mode, scoped CSS is inlined directly into HTML
    expect(indexHtml).toContain("<style");

    // Verify external CSS mode emits separate .css chunk
    const externalConfig = await resolveConfig(exampleDir, { cssStrategy: "external" });
    const externalBuilder = new Builder(externalConfig);
    const externalResult = await externalBuilder.build();
    expect(externalResult.success).toBe(true);
    const hasExternalCssChunk = externalResult.outputFiles.some((f) => f.endsWith(".css"));
    expect(hasExternalCssChunk).toBe(true);

    // Clean up dist
    if (existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
