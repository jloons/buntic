import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { VirtualFileSystem } from "../src/template/vfs.ts";
import { CssDependencyGraph } from "../src/template/css-graph.ts";

describe("CssDependencyGraph & Global Root Detection", () => {
  const tmpDir = resolve(__dirname, "../.tmp-test-css-graph");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("identifies a single global CSS root when one root imports other files", async () => {
    mkdirSync(join(tmpDir, "styles"), { recursive: true });

    // reset.css and tokens.css
    writeFileSync(join(tmpDir, "styles/reset.css"), "* { margin: 0; }");
    writeFileSync(join(tmpDir, "styles/tokens.css"), ":root { --brand: #ff0000; }");

    // main.css imports both
    writeFileSync(
      join(tmpDir, "styles/main.css"),
      `@import "./reset.css";\n@import "./tokens.css";\nbody { color: var(--brand); }`
    );

    const vfs = new VirtualFileSystem(tmpDir);
    const graph = new CssDependencyGraph(tmpDir);
    await graph.analyze(vfs);

    const result = graph.getGlobalRoot();
    expect(result.root).toBe(join(tmpDir, "styles/main.css"));
    expect(result.relativeRoot).toBe("styles/main.css");
    expect(result.conflicts).toEqual([]);
    expect(result.hasCycle).toBe(false);
  });

  it("detects conflict when multiple orphan global roots exist", async () => {
    mkdirSync(join(tmpDir, "styles"), { recursive: true });

    // Two unconnected CSS files that nobody imports
    writeFileSync(join(tmpDir, "styles/site.css"), "body { background: white; }");
    writeFileSync(join(tmpDir, "styles/admin.css"), "body { background: black; }");

    const vfs = new VirtualFileSystem(tmpDir);
    const graph = new CssDependencyGraph(tmpDir);
    await graph.analyze(vfs);

    const result = graph.getGlobalRoot();
    expect(result.root).toBeNull();
    expect(result.conflicts.length).toBe(2);
    expect(result.conflicts).toContain(join(tmpDir, "styles/site.css"));
    expect(result.conflicts).toContain(join(tmpDir, "styles/admin.css"));
  });

  it("claims files imported by a sibling root so they are not treated as global CSS", async () => {
    mkdirSync(join(tmpDir, "components"), { recursive: true });
    mkdirSync(join(tmpDir, "styles"), { recursive: true });

    // Sibling component
    writeFileSync(join(tmpDir, "components/card.html"), `<div class="card"><slot></slot></div>`);
    writeFileSync(
      join(tmpDir, "components/card.css"),
      `@import "./card-anim.css";\n:host { display: block; }`
    );
    // Private partial imported only by card.css
    writeFileSync(join(tmpDir, "components/card-anim.css"), `@keyframes fade { from { opacity: 0; } }`);

    // Global CSS root
    writeFileSync(join(tmpDir, "styles/main.css"), `body { font-sans: inherit; }`);

    const vfs = new VirtualFileSystem(tmpDir);
    const graph = new CssDependencyGraph(tmpDir);
    await graph.analyze(vfs);

    // card-anim.css must NOT be considered a competing global root!
    const result = graph.getGlobalRoot();
    expect(result.root).toBe(join(tmpDir, "styles/main.css"));
    expect(result.conflicts).toEqual([]);
  });

  it("flattens local @import statements recursively while preserving external imports", async () => {
    mkdirSync(join(tmpDir, "styles"), { recursive: true });

    writeFileSync(join(tmpDir, "styles/reset.css"), "* { margin: 0; box-sizing: border-box; }");
    writeFileSync(join(tmpDir, "styles/colors.css"), ":root { --accent: #f59e0b; }");

    writeFileSync(
      join(tmpDir, "styles/main.css"),
      `@import "https://fonts.googleapis.com/css2?family=Inter";\n@import "./reset.css";\n@import "./colors.css";\n\nbody { color: var(--accent); }`
    );

    const vfs = new VirtualFileSystem(tmpDir);
    const graph = new CssDependencyGraph(tmpDir);
    await graph.analyze(vfs);

    const flattened = await graph.flattenCss(join(tmpDir, "styles/main.css"), vfs);

    // External import kept at top
    expect(flattened).toContain('@import "https://fonts.googleapis.com/css2?family=Inter";');
    // Local imports inlined
    expect(flattened).toContain("box-sizing: border-box;");
    expect(flattened).toContain("--accent: #f59e0b;");
    expect(flattened).toContain("body { color: var(--accent); }");
    // No remaining local @import "./..."
    expect(flattened).not.toContain('@import "./');
  });

  it("handles circular imports safely without infinite loop", async () => {
    mkdirSync(join(tmpDir, "styles"), { recursive: true });

    writeFileSync(join(tmpDir, "styles/a.css"), `@import "./b.css";\n.a { color: red; }`);
    writeFileSync(join(tmpDir, "styles/b.css"), `@import "./a.css";\n.b { color: blue; }`);

    const vfs = new VirtualFileSystem(tmpDir);
    const graph = new CssDependencyGraph(tmpDir);
    await graph.analyze(vfs);

    const result = graph.getGlobalRoot();
    expect(result.hasCycle).toBe(true);

    const flattened = await graph.flattenCss(join(tmpDir, "styles/a.css"), vfs);
    expect(flattened).toContain(".a { color: red; }");
    expect(flattened).toContain(".b { color: blue; }");
  });
});
