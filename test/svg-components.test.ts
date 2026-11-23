import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolveConfig } from "../src/config.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { Builder } from "../src/builder/builder.ts";
import { startDevServer, type DevServerInstance } from "../src/server/dev.ts";

const TEST_DIR = join(import.meta.dir, ".tmp-svg-components-test");

describe("SVG Components (<component src='...svg' />)", () => {
  let devInstance: DevServerInstance | null = null;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, "src/pages"), { recursive: true });
    mkdirSync(join(TEST_DIR, "src/layouts"), { recursive: true });
    mkdirSync(join(TEST_DIR, "src/icons"), { recursive: true });
    mkdirSync(join(TEST_DIR, "src/components"), { recursive: true });
    mkdirSync(join(TEST_DIR, "src/public"), { recursive: true });
  });

  afterEach(() => {
    if (devInstance) {
      devInstance.stop();
      devInstance = null;
    }
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("inlines SVG, strips XML prologue, and merges passthrough attributes", async () => {
    const svgPath = join(TEST_DIR, "src/icons/check.svg");
    writeFileSync(
      svgPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" class="icon-base" width="16" height="16" viewBox="0 0 16 16">
  <path d="M1 8l4 4L15 2" fill="none" stroke="currentColor"/>
</svg>`
    );

    const config = await resolveConfig(TEST_DIR);
    const engine = new TemplateEngine(config);

    const pageHtml = `
      <div>
        <component src="../icons/check.svg" class="custom-check" width="24" height="24" aria-hidden="true" role="img" />
      </div>
    `;

    const rendered = await engine.renderPage(pageHtml, join(TEST_DIR, "src/pages/index.html"));

    expect(rendered).not.toContain("<?xml");
    expect(rendered).not.toContain("<!DOCTYPE");
    expect(rendered).toContain('class="icon-base custom-check"');
    expect(rendered).toContain('width="24"');
    expect(rendered).toContain('height="24"');
    expect(rendered).toContain('aria-hidden="true"');
    expect(rendered).toContain('role="img"');
    expect(rendered).toContain('viewBox="0 0 16 16"');
  });

  test("applies sibling CSS (.svg + .css) to inline SVG component", async () => {
    const svgPath = join(TEST_DIR, "src/icons/star.svg");
    const cssPath = join(TEST_DIR, "src/icons/star.css");

    writeFileSync(
      svgPath,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="12 2 15 8 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 8"/></svg>`
    );
    writeFileSync(
      cssPath,
      `& { fill: gold; }\n&:hover { fill: orange; }`
    );

    const config = await resolveConfig(TEST_DIR);
    const engine = new TemplateEngine(config);

    const pageHtml = `
      <!doctype html>
      <html>
        <head><title>Test</title></head>
        <body>
          <component src="../icons/star.svg" class="star-rating" />
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(pageHtml, join(TEST_DIR, "src/pages/index.html"));

    expect(rendered).toMatch(/<svg[^>]*class="star-rating (bs-[a-z0-9]+)"/);
    expect(rendered).toContain('<style id="__buntic_scoped">');
    expect(rendered).toContain("fill: gold;");
    expect(rendered).toContain("fill: orange;");
  });

  test("keeps scoped styles inside Shadow DOM when SVG is used in Web Component DSD", async () => {
    const iconSvg = join(TEST_DIR, "src/icons/clipboard.svg");
    const iconCss = join(TEST_DIR, "src/icons/clipboard.css");
    writeFileSync(
      iconSvg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`
    );
    writeFileSync(iconCss, `& { color: blue; }`);

    // Web Component triad: tag-badge
    writeFileSync(
      join(TEST_DIR, "src/components/tag-badge.ts"),
      `class TagBadge extends HTMLElement {} customElements.define("tag-badge", TagBadge);`
    );
    writeFileSync(
      join(TEST_DIR, "src/components/tag-badge.css"),
      `:host { display: inline-flex; }`
    );
    writeFileSync(
      join(TEST_DIR, "src/components/tag-badge.html"),
      `<span class="badge"><component src="../icons/clipboard.svg" class="icon" /><slot></slot></span>`
    );

    const config = await resolveConfig(TEST_DIR);
    const engine = new TemplateEngine(config);

    const pageHtml = `
      <!doctype html>
      <html>
        <head><title>Test DSD</title></head>
        <body>
          <tag-badge><span>v1.0</span></tag-badge>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(pageHtml, join(TEST_DIR, "src/pages/index.html"));

    // The <template shadowrootmode="open"> must contain the DSD scoped style block for the SVG
    expect(rendered).toContain('<template shadowrootmode="open">');
    const shadowMatch = rendered.match(/<template shadowrootmode="open">([\s\S]*?)<\/template>/)?.[1] || "";
    expect(shadowMatch).toContain('<style data-buntic="dsd-scoped">');
    expect(shadowMatch).toContain("color: blue;");
    expect(shadowMatch).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="icon');

    // The outer <head> should NOT have leaked the SVG's inner DSD style
    const headScoped = rendered.match(/<style id="__buntic_scoped">[\s\S]*?<\/style>/)?.[0] || "";
    expect(headScoped).not.toContain("color: blue;");
  });

  test("produces identical output between dev and build for both inline and public static SVGs", async () => {
    // 1. Setup layout, page, inline SVG and public SVG
    writeFileSync(
      join(TEST_DIR, "src/public/logo.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>`
    );
    writeFileSync(
      join(TEST_DIR, "src/icons/arrow.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5 10h10"/></svg>`
    );
    writeFileSync(
      join(TEST_DIR, "src/layouts/main.html"),
      `<!doctype html><html><head><title>Layout</title></head><body><header><img src="/logo.svg" alt="Logo" width="30" height="30"></header><main><slot></slot></main></body></html>`
    );
    writeFileSync(
      join(TEST_DIR, "src/pages/index.html"),
      `<layout src="../layouts/main.html"><h1>Inicio</h1><component src="../icons/arrow.svg" class="nav-arrow" aria-hidden="true" /></layout>`
    );

    const devPort = 38991;
    const devConfig = await resolveConfig(TEST_DIR, { port: devPort });
    devInstance = startDevServer(devConfig);

    const outDir = join(TEST_DIR, "dist");
    const buildConfig = await resolveConfig(TEST_DIR, { outDir });
    const builder = new Builder(buildConfig);
    await builder.build();

    const devRes = await fetch(`http://localhost:${devPort}/`);
    const devHtml = await devRes.text();
    const buildHtml = await Bun.file(join(outDir, "index.html")).text();

    // Verify public logo is copied to dist and referenced identically
    expect(existsSync(join(outDir, "logo.svg"))).toBe(true);
    expect(devHtml).toContain('<img src="/logo.svg" alt="Logo" width="30" height="30">');
    expect(buildHtml).toContain('<img src="/logo.svg" alt="Logo" width="30" height="30">');

    // Verify inline SVG is rendered identically with passed attributes
    const inlineDev = devHtml.match(/<svg[^>]*class="nav-arrow"[^>]*>[\s\S]*?<\/svg>/)?.[0];
    const inlineBuild = buildHtml.match(/<svg[^>]*class="nav-arrow"[^>]*>[\s\S]*?<\/svg>/)?.[0];
    expect(inlineDev).toBeDefined();
    expect(inlineBuild).toBe(inlineDev);
    expect(inlineDev).toContain('aria-hidden="true"');
  });
});
