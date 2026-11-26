import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "../src/config.ts";
import { startDevServer } from "../src/server/dev.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { BunticTemplateError, formatCodeFrame } from "../src/template/errors.ts";

describe("Detailed Template Error Reporting", () => {
  const tempDirs: string[] = [];

  function makeProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "buntic-template-errors-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "src/pages"), { recursive: true });
    mkdirSync(join(dir, "src/layouts"), { recursive: true });
    mkdirSync(join(dir, "src/components"), { recursive: true });
    mkdirSync(join(dir, "src/data"), { recursive: true });
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test("reports exact template file, line, code frame, resolved file, and hint when <each src> resolves an HTML file", async () => {
    const root = makeProject();
    writeFileSync(
      join(root, "src/layouts/main.html"),
      "<!doctype html><html><body><main><slot></slot></main></body></html>",
      "utf8"
    );
    writeFileSync(
      join(root, "src/data/workers.json"),
      JSON.stringify([{ name: "Alice" }]),
      "utf8"
    );
    const pagePath = join(root, "src/pages/workers.html");
    const pageContent = [
      '<layout src="../layouts/main.html">',
      "  <section>",
      '    <each src="workers">',
      "      <h1>cat</h1>",
      "    </each>",
      "  </section>",
      "</layout>",
    ].join("\n");
    writeFileSync(pagePath, pageContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    let caught: unknown;
    try {
      await engine.renderPage(pageContent, pagePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BunticTemplateError);
    const err = caught as BunticTemplateError;
    expect(err.filePath).toBe("src/pages/workers.html");
    expect(err.line).toBe(3);
    expect(err.column).toBe(5);
    expect(err.resolvedTarget).toBe("src/pages/workers.html");
    expect(err.causeMessage).toContain("JSON Parse error");
    expect(err.message).toContain("src/pages/workers.html:3:5");
    expect(err.message).toContain('> 3 |     <each src="workers">');
    expect(err.message).toContain("^^^^^^^^^^^^^^^^^^^^");
    expect(err.hint).toContain('extension ".html"');
    expect(err.hint).toContain('<each in="workers">');
  });

  test("reports JSON syntax errors when <each src> points to a malformed .json file", async () => {
    const root = makeProject();
    writeFileSync(join(root, "src/data/broken.json"), "{ invalid json", "utf8");
    const pagePath = join(root, "src/pages/index.html");
    const pageContent = '<h1>Home</h1>\n<each src="broken.json">\n  <p>{{name}}</p>\n</each>';
    writeFileSync(pagePath, pageContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    // Note: loadGlobalData also reads src/data/*.json; test data-loader propagation here
    let caught: unknown;
    try {
      await engine.renderPage(pageContent, pagePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BunticTemplateError);
    const err = caught as BunticTemplateError;
    expect(err.filePath).toBe("src/data/broken.json");
    expect(err.message).toContain('Failed to parse global JSON data file "src/data/broken.json"');
    expect(err.causeMessage).toContain("JSON Parse error");
  });

  test("reports exact line and hint when <each src> points to a missing file while key exists in context", async () => {
    const root = makeProject();
    writeFileSync(
      join(root, "src/data/workers.json"),
      JSON.stringify([{ name: "Alice" }]),
      "utf8"
    );
    const pagePath = join(root, "src/pages/index.html");
    const pageContent = '<div>\n  <each src="workers">\n    <p>{{name}}</p>\n  </each>\n</div>';
    writeFileSync(pagePath, pageContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    let caught: unknown;
    try {
      await engine.renderPage(pageContent, pagePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BunticTemplateError);
    const err = caught as BunticTemplateError;
    expect(err.filePath).toBe("src/pages/index.html");
    expect(err.line).toBe(2);
    expect(err.message).toContain('<each> data file not found: "workers"');
    expect(err.hint).toContain('<each in="workers">');
  });

  test("reports exact line for <each> without src or in attributes", async () => {
    const root = makeProject();
    const pagePath = join(root, "src/pages/index.html");
    const pageContent = "<h1>Test</h1>\n<each>\n  <p>hi</p>\n</each>";
    writeFileSync(pagePath, pageContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    let caught: unknown;
    try {
      await engine.renderPage(pageContent, pagePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BunticTemplateError);
    const err = caught as BunticTemplateError;
    expect(err.filePath).toBe("src/pages/index.html");
    expect(err.line).toBe(2);
    expect(err.message).toContain('requires either a "src" or "in" attribute');
    expect(err.message).toContain("> 2 | <each>");
  });

  test("reports exact line and available keys when <each in> does not resolve to an array", async () => {
    const root = makeProject();
    writeFileSync(
      join(root, "src/data/site.json"),
      JSON.stringify({ title: "Demo" }),
      "utf8"
    );
    const pagePath = join(root, "src/pages/index.html");
    const pageContent = '<div>\n  <each in="missingList">\n    <p>{{item}}</p>\n  </each>\n</div>';
    writeFileSync(pagePath, pageContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    let caught: unknown;
    try {
      await engine.renderPage(pageContent, pagePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BunticTemplateError);
    const err = caught as BunticTemplateError;
    expect(err.filePath).toBe("src/pages/index.html");
    expect(err.line).toBe(2);
    expect(err.message).toContain('did not resolve to an array (received undefined)');
    expect(err.hint).toContain("site");
  });

  test("reports exact line and code frame for missing <layout> and <component>", async () => {
    const root = makeProject();
    const layoutPage = join(root, "src/pages/bad-layout.html");
    const layoutContent = '<!-- header -->\n<layout src="missing.html">\n  <p>Hi</p>\n</layout>';
    writeFileSync(layoutPage, layoutContent, "utf8");

    const compPage = join(root, "src/pages/bad-comp.html");
    const compContent = '<div>\n  <h1>Hello</h1>\n  <component src="missing-card.html" />\n</div>';
    writeFileSync(compPage, compContent, "utf8");

    const config = await resolveConfig(root);
    const engine = new TemplateEngine(config);

    let layoutErr: unknown;
    try {
      await engine.renderPage(layoutContent, layoutPage);
    } catch (err) {
      layoutErr = err;
    }
    expect(layoutErr).toBeInstanceOf(BunticTemplateError);
    expect((layoutErr as BunticTemplateError).line).toBe(2);
    expect((layoutErr as BunticTemplateError).message).toContain('Layout not found: "missing.html"');
    expect((layoutErr as BunticTemplateError).message).toContain('> 2 | <layout src="missing.html">');

    let compErr: unknown;
    try {
      await engine.renderPage(compContent, compPage);
    } catch (err) {
      compErr = err;
    }
    expect(compErr).toBeInstanceOf(BunticTemplateError);
    expect((compErr as BunticTemplateError).line).toBe(3);
    expect((compErr as BunticTemplateError).message).toContain('Component not found: "missing-card.html"');
    expect((compErr as BunticTemplateError).message).toContain('> 3 |   <component src="missing-card.html" />');
  });

  test("DevServer renders structured HTML error overlay with file, line, code frame, hint, XSS escaping, and live-reload", async () => {
    const root = makeProject();
    writeFileSync(
      join(root, "src/data/workers.json"),
      JSON.stringify([{ name: "Alice" }]),
      "utf8"
    );
    writeFileSync(
      join(root, "src/pages/workers.html"),
      '<h1>Workers</h1>\n<each src="workers">\n\t<h1>cat</h1>\n</each>',
      "utf8"
    );

    const config = await resolveConfig(root, { port: 38912 });
    const dev = startDevServer(config);

    try {
      const res = await fetch(`http://localhost:${dev.port}/workers`);
      expect(res.status).toBe(500);
      const html = await res.text();
      expect(html).toContain("[Buntic Template Error]");
      expect(html).toContain("src/pages/workers.html:2:1");
      expect(html).toContain("&lt;each src=&quot;workers&quot;&gt;");
      expect(html).toContain("JSON Parse error");
      expect(html).toContain("Hint:");
      expect(html).toContain("__buntic_live_reload");
    } finally {
      dev.stop();
    }
  });

  test("formatCodeFrame preserves tab indentation for caret alignment", () => {
    const src = '<div>\n\t<each src="workers">\n\t\t<h1>cat</h1>\n\t</each>\n</div>';
    const frame = formatCodeFrame(src, 2, 2, 22);
    expect(frame).toContain('> 2 | \t<each src="workers">');
    expect(frame).toContain("    | \t^^^^^^^^^^^^^^^^^^^^");
  });
});
