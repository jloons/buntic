import { describe, test, expect } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import { Builder } from "../src/builder/builder.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

describe("Builder", () => {
  test("builds the example project successfully", async () => {
    const exampleDir = join(import.meta.dir, "../example");
    const outDir = join(exampleDir, "dist");

    // Clean any previous dist
    if (existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }

    const config = await resolveConfig(exampleDir);
    const builder = new Builder(config);
    const result = await builder.build();

    expect(result.success).toBe(true);
    expect(result.pagesCount).toBe(2);

    // Verify generated HTML pages
    const indexHtmlPath = join(outDir, "index.html");
    const aboutHtmlPath = join(outDir, "about.html");
    expect(existsSync(indexHtmlPath)).toBe(true);
    expect(existsSync(aboutHtmlPath)).toBe(true);

    const indexHtml = await Bun.file(indexHtmlPath).text();
    expect(indexHtml).toContain("Bienvenido a Bustatic");
    expect(indexHtml).toContain("<counter-button></counter-button>");
    expect(indexHtml).toContain("Inicio - Bustatic");

    const aboutHtml = await Bun.file(aboutHtmlPath).text();
    expect(aboutHtml).toContain("Acerca de Bustatic");

    // Verify robots.txt from public/ copied to dist/
    const robotsPath = join(outDir, "robots.txt");
    expect(existsSync(robotsPath)).toBe(true);

    // Verify bundled CSS / JS assets exist in dist/
    const hasCssChunk = result.outputFiles.some((f) => f.endsWith(".css"));
    const hasJsChunk = result.outputFiles.some((f) => f.endsWith(".js"));
    expect(hasCssChunk).toBe(true);
    expect(hasJsChunk).toBe(true);
  });
});
