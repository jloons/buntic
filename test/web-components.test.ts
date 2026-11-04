import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WebComponentRegistry } from "../src/template/web-components.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { Builder } from "../src/builder/builder.ts";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { ResolvedConfig } from "../src/types.ts";

describe("Web Components Auto-Import & Registry", () => {
  it("extracts custom elements from code with customElements.define", () => {
    const registry = new WebComponentRegistry();
    const code = `
      class UserCard extends HTMLElement {}
      customElements.define("user-card", UserCard);
    `;
    const tags = registry.registerFile("/src/components/user-card.ts", code);
    expect(tags).toEqual(["user-card"]);
    expect(registry.findScriptForTag("user-card")).toBe("/src/components/user-card.ts");
  });

  it("extracts custom elements from filename conventions", () => {
    const registry = new WebComponentRegistry();
    // Kebab case filename
    const tags1 = registry.registerFile("/src/components/fancy-button.ts", "console.log('hi');");
    expect(tags1).toEqual(["fancy-button"]);

    // PascalCase filename
    const tags2 = registry.registerFile("/src/components/UserProfile.ts", "console.log('hi');");
    expect(tags2).toEqual(["user-profile"]);
    expect(registry.findScriptForTag("user-profile")).toBe("/src/components/UserProfile.ts");
  });

  it("validates W3C Custom Element specifications and rejects reserved names", () => {
    const registry = new WebComponentRegistry();
    expect(registry.validateTagName("div").valid).toBe(false);
    expect(registry.validateTagName("font-face").valid).toBe(false);
    expect(registry.validateTagName("1-widget").valid).toBe(false);
    expect(registry.validateTagName("valid-element").valid).toBe(true);
  });

  it("detects tag collisions between two files and assertNoConflicts throws", () => {
    const registry = new WebComponentRegistry();
    registry.registerFile("/src/components/first.ts", 'customElements.define("awesome-card", Card1);');
    registry.registerFile("/src/components/second.ts", 'customElements.define("awesome-card", Card2);');

    const conflicts = registry.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].tag).toBe("awesome-card");
    expect(conflicts[0].files).toEqual(["/src/components/first.ts", "/src/components/second.ts"]);

    expect(() => registry.assertNoConflicts()).toThrow("Tag collision detected");
  });

  it("handles hot-reload cache invalidation and cleans up collisions", () => {
    const registry = new WebComponentRegistry();
    registry.registerFile("/src/components/first.ts", 'customElements.define("my-button", Btn);');
    registry.registerFile("/src/components/second.ts", 'customElements.define("my-button", Btn);');
    expect(registry.getConflicts().length).toBe(1);

    // Renaming second.ts to "other-button"
    registry.registerFile("/src/components/second.ts", 'customElements.define("other-button", Btn);');
    expect(registry.getConflicts().length).toBe(0);
    expect(registry.findScriptForTag("my-button")).toBe("/src/components/first.ts");
    expect(registry.findScriptForTag("other-button")).toBe("/src/components/second.ts");

    // Deleting first.ts
    registry.unregisterFile("/src/components/first.ts");
    expect(registry.findScriptForTag("my-button")).toBeUndefined();
  });

  it("tracks unused registered Web Components", () => {
    const registry = new WebComponentRegistry();
    registry.registerFile("/src/components/alpha-box.ts", 'customElements.define("alpha-box", Box);');
    registry.registerFile("/src/components/beta-box.ts", 'customElements.define("beta-box", Box);');

    // alpha-box is used
    registry.markTagUsed("alpha-box");

    const unused = registry.getUnusedComponents();
    expect(unused.length).toBe(1);
    expect(unused[0].tag).toBe("beta-box");
    expect(unused[0].file).toBe("/src/components/beta-box.ts");
  });
});

describe("Template Engine Web Component Injection", () => {
  const exampleRoot = resolve(__dirname, "../example");
  const config: ResolvedConfig = {
    root: exampleRoot,
    pagesDir: join(exampleRoot, "pages"),
    layoutsDir: join(exampleRoot, "layouts"),
    componentsDir: join(exampleRoot, "components"),
    dataDir: join(exampleRoot, "data"),
    publicDir: join(exampleRoot, "public"),
    outDir: join(exampleRoot, "dist"),
    minify: false,
    port: 3000,
  };

  it("auto-injects <script type='module'> into <head> when Web Component tag is used", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head><title>Test</title></head>
        <body>
          <counter-button></counter-button>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html);
    expect(rendered).toContain('<script type="module" src="/components/counter.ts"></script>');
    expect(rendered).toContain("</head>");
  });

  it("does not duplicate script tag if already present in HTML", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Test</title>
          <script type="module" src="/components/counter.ts"></script>
        </head>
        <body>
          <counter-button></counter-button>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html);
    const count = (rendered.match(/\/components\/counter\.ts/g) || []).length;
    expect(count).toBe(1);
  });
});

describe("Builder Collision Prevention", () => {
  const testRoot = resolve(__dirname, "../.tmp-test-collision");

  beforeEach(() => {
    if (rmSync) rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(testRoot, "pages"), { recursive: true });
    mkdirSync(join(testRoot, "components"), { recursive: true });

    writeFileSync(join(testRoot, "pages/index.html"), "<h1>Test</h1><dup-elem></dup-elem>");
    writeFileSync(
      join(testRoot, "components/elem-one.ts"),
      'customElements.define("dup-elem", class extends HTMLElement {});'
    );
    writeFileSync(
      join(testRoot, "components/elem-two.ts"),
      'customElements.define("dup-elem", class extends HTMLElement {});'
    );
  });

  afterEach(() => {
    if (rmSync) rmSync(testRoot, { recursive: true, force: true });
  });

  it("throws conflict error during build when duplicate custom elements are registered", async () => {
    const testConfig: ResolvedConfig = {
      root: testRoot,
      pagesDir: join(testRoot, "pages"),
      layoutsDir: join(testRoot, "layouts"),
      componentsDir: join(testRoot, "components"),
      dataDir: join(testRoot, "data"),
      publicDir: join(testRoot, "public"),
      outDir: join(testRoot, "dist"),
      minify: false,
      port: 3000,
    };

    const builder = new Builder(testConfig);
    await expect(builder.build()).rejects.toThrow("Tag collision detected between Web Components");
  });

  it("warns about registered Web Components that are never used", async () => {
    // Only one component, but pages don't use it
    writeFileSync(join(testRoot, "pages/index.html"), "<h1>Test</h1>");
    rmSync(join(testRoot, "components/elem-two.ts"), { force: true });

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.join(" "));
      origWarn(...args);
    };

    try {
      const testConfig: ResolvedConfig = {
        root: testRoot,
        pagesDir: join(testRoot, "pages"),
        layoutsDir: join(testRoot, "layouts"),
        componentsDir: join(testRoot, "components"),
        dataDir: join(testRoot, "data"),
        publicDir: join(testRoot, "public"),
        outDir: join(testRoot, "dist"),
        minify: false,
        port: 3000,
      };

      const builder = new Builder(testConfig);
      await builder.build();

      const hasUnusedWarn = warnings.some(
        (w) => w.includes("Web Component") && w.includes("<dup-elem>") && w.includes("not used")
      );
      expect(hasUnusedWarn).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
