import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WebComponentRegistry } from "../src/template/web-components.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { Builder } from "../src/builder/builder.ts";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { ResolvedConfig } from "../src/types.ts";

describe("Web Components Auto-Import & Registry (Strict 1:1 Convention)", () => {
  it("extracts custom elements when filename matches kebab-case", () => {
    const registry = new WebComponentRegistry();
    const code = `
      class UserCard extends HTMLElement {}
      customElements.define("user-card", UserCard);
    `;
    const tags = registry.registerFile("/src/components/user-card.ts", code);
    expect(tags).toEqual(["user-card"]);
    expect(registry.findScriptForTag("user-card")).toBe("/src/components/user-card.ts");
  });

  it("extracts custom elements when filename is PascalCase (e.g. UserProfile.ts -> user-profile)", () => {
    const registry = new WebComponentRegistry();
    const tags = registry.registerFile("/src/components/UserProfile.ts", "console.log('hi');");
    expect(tags).toEqual(["user-profile"]);
    expect(registry.findScriptForTag("user-profile")).toBe("/src/components/UserProfile.ts");
  });

  it("rejects registration when tag does not match filename", () => {
    const registry = new WebComponentRegistry();
    const code = `customElements.define("mismatched-tag", class extends HTMLElement {});`;
    const tags = registry.registerFile("/src/components/my-button.ts", code);
    expect(tags).toEqual([]);
    expect(registry.findScriptForTag("mismatched-tag")).toBeUndefined();
  });

  it("rejects registration when a file declares multiple custom elements", () => {
    const registry = new WebComponentRegistry();
    const code = `
      customElements.define("first-element", class extends HTMLElement {});
      customElements.define("second-element", class extends HTMLElement {});
    `;
    const tags = registry.registerFile("/src/components/first-element.ts", code);
    expect(tags).toEqual([]);
    expect(registry.findScriptForTag("first-element")).toBeUndefined();
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
    registry.registerFile("/src/pkg-a/awesome-card.ts", 'customElements.define("awesome-card", Card1);');
    registry.registerFile("/src/pkg-b/awesome-card.ts", 'customElements.define("awesome-card", Card2);');

    const conflicts = registry.getConflicts();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].tag).toBe("awesome-card");
    expect(conflicts[0].files).toEqual(["/src/pkg-a/awesome-card.ts", "/src/pkg-b/awesome-card.ts"]);

    expect(() => registry.assertNoConflicts()).toThrow("Tag collision detected");
  });

  it("handles hot-reload cache invalidation and cleans up collisions", () => {
    const registry = new WebComponentRegistry();
    registry.registerFile("/src/pkg-a/my-button.ts", 'customElements.define("my-button", Btn);');
    registry.registerFile("/src/pkg-b/my-button.ts", 'customElements.define("my-button", Btn);');
    expect(registry.getConflicts().length).toBe(1);

    // Renaming pkg-b file from my-button.ts to other-button.ts
    registry.unregisterFile("/src/pkg-b/my-button.ts");
    registry.registerFile("/src/pkg-b/other-button.ts", 'customElements.define("other-button", Btn);');
    expect(registry.getConflicts().length).toBe(0);
    expect(registry.findScriptForTag("my-button")).toBe("/src/pkg-a/my-button.ts");
    expect(registry.findScriptForTag("other-button")).toBe("/src/pkg-b/other-button.ts");

    // Deleting pkg-a file
    registry.unregisterFile("/src/pkg-a/my-button.ts");
    expect(registry.findScriptForTag("my-button")).toBeUndefined();
  });

  it("tracks unused registered Web Components", () => {
    const registry = new WebComponentRegistry();
    registry.registerFile("/src/components/alpha-box.ts", 'customElements.define("alpha-box", Box);');
    registry.registerFile("/src/components/beta-box.ts", 'customElements.define("beta-box", Box);');

    registry.markTagUsed("alpha-box");

    const unused = registry.getUnusedComponents();
    expect(unused.length).toBe(1);
    expect(unused[0].tag).toBe("beta-box");
    expect(unused[0].file).toBe("/src/components/beta-box.ts");
  });
});

describe("Template Engine Declarative Shadow DOM Injection", () => {
  const exampleRoot = resolve(__dirname, "fixtures/web-components");
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
    cssStrategy: "inline",
  };

  it("injects <template shadowrootmode='open'> and script tag for counter-button", async () => {
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
    // Auto-injects module script
    expect(rendered).toContain('<script type="module" src="/components/counter-button.ts"></script>');
    // Auto-injects Declarative Shadow DOM
    expect(rendered).toContain('<template shadowrootmode="open">');
    // Injects component HTML template inside DSD
    expect(rendered).toContain('id="btn"');
    expect(rendered).toContain("Clicks: 0");
    // Injects sibling CSS inside DSD with :host without class hashing (.bs-xxxx)
    expect(rendered).toContain(":host {");
    expect(rendered).toContain("#btn {");
    expect(rendered).not.toContain(".bs-counter-button");
  });

  it("preserves Light DOM children for native <slot> projection", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head><title>Test</title></head>
        <body>
          <counter-button>
            <span class="user-label">Mi Contador</span>
          </counter-button>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html);
    expect(rendered).toContain('<template shadowrootmode="open">');
    // User children remain in Light DOM right after template
    expect(rendered).toContain('<span class="user-label">Mi Contador</span>');
    expect(rendered).toContain("</counter-button>");
  });

  it("does not duplicate script tag if already present in HTML", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Test</title>
          <script type="module" src="/components/counter-button.ts"></script>
        </head>
        <body>
          <counter-button></counter-button>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html);
    const count = (rendered.match(/\/components\/counter-button\.ts/g) || []).length;
    expect(count).toBe(1);
  });

  it("resolves nested Web Components inside another Web Component's sibling HTML template", async () => {
    const engine = new TemplateEngine(config);
    const vfs = (engine as any).vfs;

    // Register a parent Web Component with sibling HTML that contains <counter-button>
    const parentScript = join(exampleRoot, "components/parent-card.ts");
    const parentHtml = join(exampleRoot, "components/parent-card.html");

    vfs.registry.registerFile(parentScript, 'customElements.define("parent-card", class extends HTMLElement {});');
    vfs.knownFiles.add(parentHtml);
    vfs.contentCache.set(
      parentHtml,
      `<div class="parent-box">
        <h3><slot name="title">Default Title</slot></h3>
        <counter-button></counter-button>
      </div>`
    );

    const html = `
      <!doctype html>
      <html>
        <head><title>Test</title></head>
        <body>
          <parent-card><span slot="title">Nested Card</span></parent-card>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html);

    // Both scripts injected
    expect(rendered).toContain('<script type="module" src="/components/parent-card.ts"></script>');
    expect(rendered).toContain('<script type="module" src="/components/counter-button.ts"></script>');

    // Declarative Shadow DOM for parent-card
    expect(rendered).toContain('<parent-card>');
    expect(rendered).toContain('class="parent-box"');

    // Declarative Shadow DOM for counter-button inside parent-card template
    expect(rendered).toContain('Clicks: 0');
    expect(rendered).toContain('id="btn"');

    // Light DOM slot projection preserved
    expect(rendered).toContain('<span slot="title">Nested Card</span>');

    // Clean up mock entries
    vfs.registry.unregisterFile(parentScript);
    vfs.knownFiles.delete(parentHtml);
    vfs.contentCache.delete(parentHtml);
  });

  it("resolves <component src='...ts' /> self-closing alias for Web Components", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head><title>Alias Test</title></head>
        <body>
          <component src="../components/counter-button.ts" id="my-counter" />
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html, join(exampleRoot, "pages/test.html"));
    // Replaced with custom element tag and attributes preserved
    expect(rendered).toContain('<counter-button id="my-counter">');
    // Script injected
    expect(rendered).toContain('<script type="module" src="/components/counter-button.ts"></script>');
    // Declarative Shadow DOM injected
    expect(rendered).toContain('<template shadowrootmode="open">');
    expect(rendered).toContain('id="btn"');
  });

  it("resolves <component src='...ts'> with inner slots and children", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head><title>Alias with Children</title></head>
        <body>
          <component src="../components/interactive-card.ts">
            <span slot="title">Título Vía Alias</span>
            <p>Contenido proyectado</p>
          </component>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html, join(exampleRoot, "pages/test.html"));
    // Replaced with custom element tag
    expect(rendered).toContain('<interactive-card>');
    expect(rendered).toContain('<span slot="title">Título Vía Alias</span>');
    expect(rendered).toContain('<p>Contenido proyectado</p>');
    // DSD injected for both interactive-card and nested counter-button
    expect(rendered).toContain('<script type="module" src="/components/interactive-card.ts"></script>');
    expect(rendered).toContain('<script type="module" src="/components/counter-button.ts"></script>');
  });

  it("throws actionable error when <component src='...ts'> file does not exist", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <body>
          <component src="../components/non-existent-component.ts" />
        </body>
      </html>
    `;

    await expect(engine.renderPage(html, join(exampleRoot, "pages/test.html"))).rejects.toThrow(
      'Component not found: "../components/non-existent-component.ts"'
    );
  });

  it("emits warning when an unregistered Custom Element tag is declared directly in HTML", async () => {
    const engine = new TemplateEngine(config);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.join(" "));
      origWarn(...args);
    };

    try {
      const html = `
        <!doctype html>
        <html>
          <body>
            <unregistered-widget></unregistered-widget>
          </body>
        </html>
      `;

      const rendered = await engine.renderPage(html, join(exampleRoot, "pages/test.html"));
      expect(rendered).toContain("<unregistered-widget></unregistered-widget>");
      expect(warnings.some((w) => w.includes('<unregistered-widget>') && w.includes("no matching Web Component file"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it("does not skip script injection when the script path appears as plain text/code in HTML body", async () => {
    const engine = new TemplateEngine(config);
    const html = `
      <!doctype html>
      <html>
        <head><title>Text match test</title></head>
        <body>
          <p>Mira este archivo: <code>/components/counter-button.ts</code></p>
          <counter-button></counter-button>
        </body>
      </html>
    `;

    const rendered = await engine.renderPage(html, join(exampleRoot, "pages/test.html"));
    expect(rendered).toContain('<script type="module" src="/components/counter-button.ts"></script>');
  });
});

describe("Builder Collision Prevention", () => {
  const testRoot = resolve(__dirname, "../.tmp-test-collision");

  beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(testRoot, "pages"), { recursive: true });
    mkdirSync(join(testRoot, "pkg-a"), { recursive: true });
    mkdirSync(join(testRoot, "pkg-b"), { recursive: true });

    writeFileSync(join(testRoot, "pages/index.html"), "<h1>Test</h1><dup-elem></dup-elem>");
    writeFileSync(
      join(testRoot, "pkg-a/dup-elem.ts"),
      'customElements.define("dup-elem", class extends HTMLElement {});'
    );
    writeFileSync(
      join(testRoot, "pkg-b/dup-elem.ts"),
      'customElements.define("dup-elem", class extends HTMLElement {});'
    );
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
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
    writeFileSync(join(testRoot, "pages/index.html"), "<h1>Test</h1>");
    rmSync(join(testRoot, "pkg-b/dup-elem.ts"), { force: true });

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
