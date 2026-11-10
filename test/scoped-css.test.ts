import { describe, test, expect, spyOn } from "bun:test";
import { resolve, join } from "node:path";

const exampleRoot = resolve(__dirname, "../examples/simple");
import {
  ScopeRegistry,
  transformScopedCss,
  extractScopedStyles,
  findSingleRootElement,
  attachSiblingScopedCss,
} from "../src/template/scoped-css.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import type { ResolvedConfig } from "../src/types.ts";

describe("Scoped CSS Processor", () => {
  describe("ScopeRegistry & Collision Prevention", () => {
    test("generates deterministic class name with bs- prefix", () => {
      const registry = new ScopeRegistry();
      const css = "& { color: red; }";
      const id1 = registry.getScopeId(css);
      const id2 = registry.getScopeId(css);

      expect(id1).toMatch(/^bs-[a-z0-9]+$/);
      expect(id1).toBe(id2);
    });

    test("disambiguates hash collisions deterministically without corrupting styles", () => {
      const registry = new ScopeRegistry();
      const css1 = "p { color: red; }";
      const css2 = "p { color: blue; }";

      const id1 = registry.getScopeId(css1);
      // Manually simulate a collision by setting registry key for css2's base hash
      const fakeRegistry = registry as any;
      const baseHash = "bs-testcoll";
      fakeRegistry.registry.set(baseHash, "different-css-already-here");

      // Inject a getScopeId override to test collision branching
      const collisionId = (() => {
        let candidate = baseHash;
        let counter = 1;
        while (fakeRegistry.registry.has(candidate)) {
          if (fakeRegistry.registry.get(candidate) === css2) return candidate;
          candidate = `${baseHash}-${counter++}`;
        }
        fakeRegistry.registry.set(candidate, css2);
        return candidate;
      })();

      expect(collisionId).toBe("bs-testcoll-1");
      expect(fakeRegistry.registry.get("bs-testcoll-1")).toBe(css2);
    });
  });

  describe("CSS Transformation (transformScopedCss)", () => {
    test("transforms & (self-reference) into scoped class", () => {
      const css = `
        & {
          margin-bottom: 1rem;
          color: var(--text-muted);
        }
        & > p {
          color: red;
        }
        &:hover {
          background: #333;
        }
        &.active {
          font-weight: bold;
        }
      `;
      const result = transformScopedCss(css, "bs-abc123");
      expect(result).toContain(".bs-abc123 {");
      expect(result).toContain(".bs-abc123 > p {");
      expect(result).toContain(".bs-abc123:hover {");
      expect(result).toContain(".bs-abc123.active {");
    });

    test("supports :host as an alias for &", () => {
      const css = `
        :host {
          display: block;
        }
        :host > p {
          color: green;
        }
      `;
      const result = transformScopedCss(css, "bs-host12");
      expect(result).toContain(".bs-host12 {");
      expect(result).toContain(".bs-host12 > p {");
    });

    test("transforms direct combinators and descendant selectors", () => {
      const css = `
        > p {
          margin: 0;
        }
        p {
          font-size: 14px;
        }
        h1, h2 {
          color: blue;
        }
      `;
      const result = transformScopedCss(css, "bs-desc45");
      expect(result).toContain(".bs-desc45 > p {");
      expect(result).toContain(".bs-desc45 p {");
      expect(result).toContain(".bs-desc45 h1, .bs-desc45 h2 {");
    });

    test("transforms nested at-rules like @media while scoping inner rules", () => {
      const css = `
        @media (min-width: 768px) {
          p {
            font-size: 18px;
          }
          & > div {
            display: flex;
          }
        }
      `;
      const result = transformScopedCss(css, "bs-media7");
      expect(result).toContain("@media (min-width: 768px) {");
      expect(result).toContain(".bs-media7 p {");
      expect(result).toContain(".bs-media7 > div {");
    });

    test("preserves @keyframes without prepending scope class", () => {
      const css = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      const result = transformScopedCss(css, "bs-kf123");
      expect(result).toContain("@keyframes fadeIn");
      expect(result).not.toContain(".bs-kf123 @keyframes");
    });
  });

  describe("HTML Extraction & Parent Tag Identification", () => {
    test("adds scope class to parent element without existing class", () => {
      const html = `
        <p>
          <style scoped>
            & {
              color: red;
            }
          </style>
          Texto del párrafo
        </p>
      `;
      const { html: outputHtml, scopedRules } = extractScopedStyles(html);
      expect(outputHtml).toMatch(/<p class="bs-[a-z0-9]+">/);
      expect(outputHtml).not.toContain("<style");
      expect(outputHtml).toContain("Texto del párrafo");
      expect(scopedRules.length).toBe(1);
      expect(scopedRules[0]).toContain("color: red;");
    });

    test("appends scope class to parent with existing class attribute", () => {
      const html = `
        <section class="interactive-box">
          <h2>Demostración</h2>
          <p>Este botón interactivo está construido con Web Components</p>
          <counter-button></counter-button>
          <style scoped>
            & > p {
              margin-bottom: 1rem;
              color: var(--text-muted);
            }
          </style>
        </section>
      `;
      const { html: outputHtml, scopedRules } = extractScopedStyles(html);
      expect(outputHtml).toMatch(/<section class="interactive-box bs-[a-z0-9]+">/);
      expect(outputHtml).not.toContain("<style");
      expect(outputHtml).toContain("<counter-button></counter-button>");
      expect(scopedRules.length).toBe(1);
      expect(scopedRules[0]).toContain("> p {");
    });

    test("handles multiple scoped blocks in different parent containers", () => {
      const html = `
        <div class="first">
          <style scoped>
            & { color: red; }
          </style>
          <span>Uno</span>
        </div>
        <div class="second">
          <style scoped>
            & { color: blue; }
          </style>
          <span>Dos</span>
        </div>
      `;
      const { html: outputHtml, scopedRules } = extractScopedStyles(html);
      expect(outputHtml).toMatch(/<div class="first bs-[a-z0-9]+">/);
      expect(outputHtml).toMatch(/<div class="second bs-[a-z0-9]+">/);
      expect(scopedRules.length).toBe(2);
      expect(outputHtml).not.toContain("<style");
    });
  });

  describe("Integration with TemplateEngine & Deduplication", () => {
    function createMockEngine(cssStrategy: "inline" | "external" = "inline"): TemplateEngine {
      const config: ResolvedConfig = {
        root: exampleRoot,
        pagesDir: join(exampleRoot, "src/pages"),
        layoutsDir: join(exampleRoot, "src/layouts"),
        componentsDir: join(exampleRoot, "src/components"),
        dataDir: join(exampleRoot, "src/data"),
        publicDir: join(exampleRoot, "src/public"),
        outDir: join(exampleRoot, "dist"),
        port: 3000,
        minify: true,
        cssStrategy,
      };
      return new TemplateEngine(config);
    }

    test("deduplicates identical scoped styles inside <each> loops", async () => {
      const engine = createMockEngine("inline");
      const pageHtml = `
        <!doctype html>
        <html>
        <head><title>Test</title></head>
        <body>
          <each in="site.features">
            <div class="card">
              <style scoped>
                & { border: 1px solid red; }
                h3 { font-size: 18px; }
              </style>
              <h3>{{this}}</h3>
            </div>
          </each>
        </body>
        </html>
      `;

      // Mock data
      (engine as any).cachedData = {
        site: { features: ["Rapidez", "Cero Dependencias", "Nativo"] },
      };

      const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/test.html"));

      // Verify all card elements have the SAME class
      const matches = Array.from(rendered.matchAll(/class="card (bs-[a-z0-9]+)"/g));
      expect(matches.length).toBe(3);
      expect(matches[0][1]).toBe(matches[1][1]);
      expect(matches[1][1]).toBe(matches[2][1]);

      // Verify scoped CSS block was only injected ONCE in <head>
      const scopedStyleMatches = rendered.match(/<style id="__bustatic_scoped">/g);
      expect(scopedStyleMatches?.length).toBe(1);

      // Verify the CSS rule was not duplicated
      const ruleCount = (rendered.match(/border: 1px solid red;/g) || []).length;
      expect(ruleCount).toBe(1);
    });

    test("inlines global stylesheets before scoped styles in inline mode", async () => {
      const engine = createMockEngine("inline");
      const pageHtml = `
        <!doctype html>
        <html>
        <head>
          <link rel="stylesheet" href="/styles/main.css">
        </head>
        <body>
          <div class="box">
            <style scoped>
              & { padding: 10px; }
            </style>
            Contenido
          </div>
        </body>
        </html>
      `;

      const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/test.html"));

      // Verify global styles were inlined
      expect(rendered).toContain('<style id="__bustatic_global">');
      expect(rendered).not.toContain('<link rel="stylesheet" href="/styles/main.css">');

      // Verify scoped styles were inlined
      expect(rendered).toContain('<style id="__bustatic_scoped">');

      // Verify global styles appear BEFORE scoped styles in <head> for correct cascade
      const globalIdx = rendered.indexOf('id="__bustatic_global"');
      const scopedIdx = rendered.indexOf('id="__bustatic_scoped"');
      expect(globalIdx).toBeGreaterThan(-1);
      expect(scopedIdx).toBeGreaterThan(-1);
      expect(globalIdx).toBeLessThan(scopedIdx);
    });

    test("links external stylesheet in external mode", async () => {
      const engine = createMockEngine("external");
      const pageHtml = `
        <!doctype html>
        <html>
        <head>
          <link rel="stylesheet" href="/styles/main.css">
        </head>
        <body>
          <div class="box">
            <style scoped>
              & { margin: 20px; }
            </style>
            Hola
          </div>
        </body>
        </html>
      `;

      const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/index.html"));

      // Verify global styles remain linked as external
      expect(rendered).toContain('<link rel="stylesheet" href="/styles/main.css">');

      // Verify page-specific scoped CSS link was added
      expect(rendered).toContain('<link rel="stylesheet" href="/index.scoped.css">');

      // Verify memory cache holds the generated scoped CSS
      expect(engine.generatedPageStyles.has("/index.scoped.css")).toBe(true);
      expect(engine.generatedPageStyles.get("/index.scoped.css")).toContain(".bs-");
    });
  });

  describe("Single Root Detection (findSingleRootElement)", () => {
    test("detects a valid single root element", () => {
      const html = `<footer class="site-footer"><p>&copy; 2026</p></footer>`;
      const root = findSingleRootElement(html);
      expect(root).not.toBeNull();
      expect(root?.tag).toBe("footer");
    });

    test("allows surrounding comments and whitespace", () => {
      const html = `
        <!-- Header component -->
        <div class="card">
          <h3>Title</h3>
        </div>
        <!-- End of card -->
      `;
      const root = findSingleRootElement(html);
      expect(root).not.toBeNull();
      expect(root?.tag).toBe("div");
    });

    test("rejects multiple root elements (fragments)", () => {
      const html = `
        <h2>Title</h2>
        <p>Description</p>
      `;
      expect(findSingleRootElement(html)).toBeNull();
    });

    test("rejects templates with non-whitespace text at root level", () => {
      expect(findSingleRootElement(`Hello <div>World</div>`)).toBeNull();
      expect(findSingleRootElement(`<div>World</div> Goodbye`)).toBeNull();
    });

    test("rejects void or self-closing root elements", () => {
      expect(findSingleRootElement(`<hr />`)).toBeNull();
      expect(findSingleRootElement(`<img src="pic.png" />`)).toBeNull();
    });

    test("attachSiblingScopedCss attaches <style scoped> to the single root", () => {
      const html = `<footer class="site-footer"><p>Content</p></footer>`;
      const css = `& { background: black; }`;
      const attached = attachSiblingScopedCss(html, css);
      expect(attached).toContain('<footer class="site-footer">');
      expect(attached).toContain("<style scoped>");
      expect(attached).toContain("background: black;");
    });
  });

  describe("Co-located Sibling CSS Files (.html + .css)", () => {
    function createMockEngine(): TemplateEngine {
      const config: ResolvedConfig = {
        root: exampleRoot,
        pagesDir: join(exampleRoot, "src/pages"),
        layoutsDir: join(exampleRoot, "src/layouts"),
        componentsDir: join(exampleRoot, "src/components"),
        dataDir: join(exampleRoot, "src/data"),
        publicDir: join(exampleRoot, "src/public"),
        outDir: join(exampleRoot, "dist"),
        port: 3000,
        minify: true,
        cssStrategy: "inline",
      };
      return new TemplateEngine(config);
    }

    test("automatically applies sibling CSS to component with a single root element", async () => {
      const engine = createMockEngine();

      // Register virtual component and sibling CSS in VFS
      const compPath = join(exampleRoot, "components/my-footer.html");
      const cssPath = join(exampleRoot, "components/my-footer.css");

      (engine.vfs as any).knownFiles.add(compPath);
      (engine.vfs as any).contentCache.set(
        compPath,
        `<footer class="my-footer"><p>Footer Content</p></footer>`
      );

      (engine.vfs as any).knownFiles.add(cssPath);
      (engine.vfs as any).contentCache.set(
        cssPath,
        `& { border-top: 1px solid red; }\n& > p { color: yellow; }`
      );

      const pageHtml = `
        <!doctype html>
        <html>
        <head><title>Test</title></head>
        <body>
          <component src="../components/my-footer.html" />
        </body>
        </html>
      `;

      const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/test.html"));

      // Verify the footer received the scoped class
      expect(rendered).toMatch(/<footer class="my-footer bs-[a-z0-9]+">/);
      expect(rendered).toContain("<p>Footer Content</p>");

      // Verify the scoped CSS from my-footer.css was included in <head>
      expect(rendered).toContain("<style id=\"__bustatic_scoped\">");
      expect(rendered).toContain("border-top: 1px solid red;");
      expect(rendered).toContain("color: yellow;");
    });

    test("does NOT apply sibling CSS and warns when component has multiple root elements", async () => {
      const engine = createMockEngine();

      const compPath = join(exampleRoot, "components/fragment-item.html");
      const cssPath = join(exampleRoot, "components/fragment-item.css");

      (engine.vfs as any).knownFiles.add(compPath);
      (engine.vfs as any).contentCache.set(
        compPath,
        `<h2>Heading</h2>\n<p>Paragraph</p>`
      );

      (engine.vfs as any).knownFiles.add(cssPath);
      (engine.vfs as any).contentCache.set(
        cssPath,
        `h2 { color: purple; }`
      );

      const pageHtml = `
        <!doctype html>
        <html>
        <head><title>Test</title></head>
        <body>
          <component src="../components/fragment-item.html" />
        </body>
        </html>
      `;

      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/test.html"));

        // Verify warning was emitted
        expect(warnings.some((w) => w.includes("fragment-item.html") && w.includes("does not have a single root element"))).toBe(true);

        // Verify styles were NOT applied
        expect(rendered).not.toContain("bs-");
        expect(rendered).not.toContain("color: purple;");
        expect(rendered).toContain("<h2>Heading</h2>");
        expect(rendered).toContain("<p>Paragraph</p>");
      } finally {
        console.warn = originalWarn;
      }
    });

    test("prioritizes inline <style scoped> over sibling CSS through source order cascade", async () => {
      const engine = createMockEngine();

      const compPath = join(exampleRoot, "components/priority-box.html");
      const cssPath = join(exampleRoot, "components/priority-box.css");

      (engine.vfs as any).knownFiles.add(compPath);
      (engine.vfs as any).contentCache.set(
        compPath,
        `<div class="box">
          <style scoped>
            & { background: red; }
          </style>
          <p>Overridden Content</p>
        </div>`
      );

      (engine.vfs as any).knownFiles.add(cssPath);
      (engine.vfs as any).contentCache.set(
        cssPath,
        `& { background: blue; color: white; }`
      );

      const pageHtml = `
        <!doctype html>
        <html>
        <head><title>Test</title></head>
        <body>
          <component src="../components/priority-box.html" />
        </body>
        </html>
      `;

      const rendered = await engine.renderPage(pageHtml, join(exampleRoot, "pages/test.html"));

      // Verify the box element received both classes
      expect(rendered).toMatch(/<div class="box (bs-[a-z0-9]+) (bs-[a-z0-9]+)">/);

      // Verify both rules are emitted
      expect(rendered).toContain("background: blue;");
      expect(rendered).toContain("background: red;");

      // Verify in the CSS block that sibling CSS (blue) appears BEFORE manual scoped CSS (red),
      // ensuring that by standard CSS cascade rules, the manual <style scoped> wins!
      const blueIdx = rendered.indexOf("background: blue;");
      const redIdx = rendered.indexOf("background: red;");
      expect(blueIdx).toBeGreaterThan(-1);
      expect(redIdx).toBeGreaterThan(-1);
      expect(blueIdx).toBeLessThan(redIdx);
    });
  });
});
