import { describe, test, expect } from "bun:test";
import { TemplateEngine } from "../src/template/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

describe("TemplateEngine", () => {
  test("interpolates data variables", async () => {
    const fixtureDir = "/tmp/buntic-test-template-data";
    mkdirSync(join(fixtureDir, "data"), { recursive: true });
    mkdirSync(join(fixtureDir, "pages"), { recursive: true });
    mkdirSync(join(fixtureDir, "layouts"), { recursive: true });
    mkdirSync(join(fixtureDir, "components"), { recursive: true });

    await Bun.write(
      join(fixtureDir, "data", "site.json"),
      JSON.stringify({ name: "Buntic Test", year: 2026 })
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const html = "<h1>{{site.name}} - {{site.year}}</h1><p>{{ site.name }}</p>";
    const rendered = await engine.renderPage(html);

    expect(rendered).toBe("<h1>Buntic Test - 2026</h1><p>Buntic Test</p>");
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves layout and default slot", async () => {
    const fixtureDir = "/tmp/buntic-test-layout";
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
    const fixtureDir = "/tmp/buntic-test-named-slots";
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
    const fixtureDir = "/tmp/buntic-test-components";
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
    const fixtureDir = "/tmp/buntic-test-relative-paths";
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

  test("resolves <each src='...'> with auto-spread to <component>", async () => {
    const fixtureDir = "/tmp/buntic-test-each-spread";
    const dataDir = join(fixtureDir, "data");
    const componentsDir = join(fixtureDir, "components");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(componentsDir, { recursive: true });

    await Bun.write(
      join(dataDir, "cards.json"),
      JSON.stringify([
        { title: "Card 1", desc: "First", badge: "NEW" },
        { title: "Card 2", desc: "Second" },
      ])
    );

    await Bun.write(
      join(componentsDir, "item.html"),
      '<div class="item"><h4>{{title}}</h4><p>{{desc}}</p><span class="badge" if="badge">{{badge}}</span></div>'
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<each src="../data/cards.json"><component src="../components/item.html" /></each>';
    const rendered = await engine.renderPage(page, join(fixtureDir, "pages/index.html"));

    expect(rendered).toContain('<h4>Card 1</h4>');
    expect(rendered).toContain('<p>First</p>');
    expect(rendered).toContain('<span class="badge">NEW</span>');

    expect(rendered).toContain('<h4>Card 2</h4>');
    expect(rendered).toContain('<p>Second</p>');
    // The second card has no badge, so <span class="badge"> must NOT exist for Card 2
    const badgeMatches = rendered.match(/<span class="badge">/g);
    expect(badgeMatches?.length).toBe(1);

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves <each in='...'> with alias and primitive arrays", async () => {
    const fixtureDir = "/tmp/buntic-test-each-in";
    const dataDir = join(fixtureDir, "data");
    mkdirSync(dataDir, { recursive: true });

    await Bun.write(
      join(dataDir, "site.json"),
      JSON.stringify({
        tags: ["bun", "ssg", "fast"],
      })
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<ul><each in="site.tags" as="tag"><li>{{tag}}</li></each></ul>';
    const rendered = await engine.renderPage(page);

    expect(rendered).toContain('<li>bun</li>');
    expect(rendered).toContain('<li>ssg</li>');
    expect(rendered).toContain('<li>fast</li>');

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves <if is='...'> with <else>", async () => {
    const fixtureDir = "/tmp/buntic-test-if-else";
    const dataDir = join(fixtureDir, "data");
    mkdirSync(dataDir, { recursive: true });

    await Bun.write(
      join(dataDir, "site.json"),
      JSON.stringify({ isOnline: true, isMaintenance: false })
    );

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = `
      <if is="site.isOnline">
        <span>Site Online</span>
        <else>
          <span>Site Offline</span>
        </else>
      </if>
      <if is="site.isMaintenance">
        <span>Maintenance Mode</span>
        <else>
          <span>Normal Operation</span>
        </else>
      </if>
    `;

    const rendered = await engine.renderPage(page);
    expect(rendered).toContain('<span>Site Online</span>');
    expect(rendered).not.toContain('<span>Site Offline</span>');
    expect(rendered).toContain('<span>Normal Operation</span>');
    expect(rendered).not.toContain('<span>Maintenance Mode</span>');

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("resolves variable fallback with ??", async () => {
    const fixtureDir = "/tmp/buntic-test-fallback";
    mkdirSync(fixtureDir, { recursive: true });

    const config = await resolveConfig(fixtureDir);
    const engine = new TemplateEngine(config);

    const page = '<p>{{site.title ?? "Default Title"}}</p><p>{{missing ?? "No Value"}}</p>';
    const rendered = await engine.renderPage(page);

    expect(rendered).toContain('<p>Default Title</p>');
    expect(rendered).toContain('<p>No Value</p>');

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
