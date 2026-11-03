import { describe, test, expect } from "bun:test";
import { TemplateEngine } from "../src/template/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

describe("TemplateEngine", () => {
  test("interpolates data variables", async () => {
    const fixtureDir = "/tmp/bustatic-test-template-data";
    mkdirSync(join(fixtureDir, "data"), { recursive: true });
    mkdirSync(join(fixtureDir, "pages"), { recursive: true });
    mkdirSync(join(fixtureDir, "layouts"), { recursive: true });
    mkdirSync(join(fixtureDir, "components"), { recursive: true });

    await Bun.write(
      join(fixtureDir, "data", "site.json"),
      JSON.stringify({ name: "Bustatic Test", year: 2026 })
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const html = "<h1>{{site.name}} - {{site.year}}</h1>";
    const rendered = await engine.renderPage(html);

    expect(rendered).toBe("<h1>Bustatic Test - 2026</h1>");
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves layout and default slot", async () => {
    const fixtureDir = "/tmp/bustatic-test-layout";
    mkdirSync(join(fixtureDir, "layouts"), { recursive: true });
    mkdirSync(join(fixtureDir, "pages"), { recursive: true });
    mkdirSync(join(fixtureDir, "components"), { recursive: true });

    await Bun.write(
      join(fixtureDir, "layouts", "main.html"),
      "<!doctype html><html><body><header>Nav</header><main><slot></slot></main></body></html>"
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<layout src="main.html"><p>Hello Page Content</p></layout>';
    const rendered = await engine.renderPage(page);

    expect(rendered).toContain("<main><p>Hello Page Content</p></main>");
    expect(rendered).toContain("<header>Nav</header>");
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves named slots in layout", async () => {
    const fixtureDir = "/tmp/bustatic-test-named-slots";
    mkdirSync(join(fixtureDir, "layouts"), { recursive: true });
    mkdirSync(join(fixtureDir, "pages"), { recursive: true });
    mkdirSync(join(fixtureDir, "components"), { recursive: true });

    await Bun.write(
      join(fixtureDir, "layouts", "main.html"),
      "<html><head><title><slot name=\"title\">Fallback</slot></title></head><body><slot></slot></body></html>"
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<layout src="main.html"><span slot="title">Custom Title</span><h1>Main Body</h1></layout>';
    const rendered = await engine.renderPage(page);

    expect(rendered).toContain("<title>Custom Title</title>");
    expect(rendered).toContain("<h1>Main Body</h1>");
    expect(rendered).not.toContain("Fallback");
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves components with props and inner slots", async () => {
    const fixtureDir = "/tmp/bustatic-test-components";
    mkdirSync(join(fixtureDir, "components"), { recursive: true });
    mkdirSync(join(fixtureDir, "pages"), { recursive: true });
    mkdirSync(join(fixtureDir, "layouts"), { recursive: true });

    await Bun.write(
      join(fixtureDir, "components", "badge.html"),
      '<div class="badge"><h3>{{label}}</h3><p><slot></slot></p></div>'
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<component src="badge.html" label="Super Fast">Extra Details</component>';
    const rendered = await engine.renderPage(page);

    expect(rendered).toContain('<h3>Super Fast</h3>');
    expect(rendered).toContain('<p>Extra Details</p>');
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves relative paths (../ and ./) with VS Code Ctrl+Click style", async () => {
    const fixtureDir = "/tmp/bustatic-test-relative-paths";
    const pagesDir = join(fixtureDir, "pages");
    const layoutsDir = join(fixtureDir, "layouts");
    const componentsDir = join(fixtureDir, "components");
    mkdirSync(pagesDir, { recursive: true });
    mkdirSync(layoutsDir, { recursive: true });
    mkdirSync(componentsDir, { recursive: true });

    // 1. Layout referencing header with relative path ../components/header.html
    await Bun.write(
      join(layoutsDir, "base.html"),
      '<html><body><component src="../components/header.html" /><slot></slot></body></html>'
    );

    // 2. Component in componentsDir
    await Bun.write(
      join(componentsDir, "header.html"),
      '<header><component src="./logo.html" /><h1>Site Title</h1></header>'
    );

    // 3. Sibling component in componentsDir
    await Bun.write(
      join(componentsDir, "logo.html"),
      '<span class="logo">⚡ LOGO</span>'
    );

    // 4. Page in pages/blog/post.html referencing layout with ../../layouts/base.html
    const blogDir = join(pagesDir, "blog");
    mkdirSync(blogDir, { recursive: true });
    const postFile = join(blogDir, "post.html");
    await Bun.write(
      postFile,
      '<layout src="../../layouts/base.html"><p>Blog Content</p></layout>'
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const postContent = await Bun.file(postFile).text();
    const rendered = await engine.renderPage(postContent, postFile);

    expect(rendered).toContain('<span class="logo">⚡ LOGO</span>');
    expect(rendered).toContain('<h1>Site Title</h1>');
    expect(rendered).toContain('<p>Blog Content</p>');

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
