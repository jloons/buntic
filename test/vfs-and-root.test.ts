import { describe, test, expect } from "bun:test";
import { findProjectRoot, resolveConfig } from "../src/config.ts";
import { VirtualFileSystem } from "../src/template/vfs.ts";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

describe("Root Discovery & Actionable Errors", () => {
  test("finds project root from explicit argument", () => {
    const exampleDir = join(import.meta.dir, "../examples/simple");
    const root = findProjectRoot(exampleDir);
    expect(root).toBe(exampleDir);
  });

  test("throws error if explicit directory does not exist", () => {
    expect(() => {
      findProjectRoot("/tmp/non-existent-bustatic-dir-12345");
    }).toThrow("Specified project directory does not exist");
  });

  test("detects project root by walking upward from a subfolder (with src/pages)", () => {
    const subfolder = join(import.meta.dir, "../examples/simple/src/pages");
    const detected = findProjectRoot(".", subfolder);
    const expected = join(import.meta.dir, "../examples/simple");
    expect(detected).toBe(expected);
  });

  test("throws actionable error with instructions when no root is found", () => {
    const emptyDir = "/tmp/bustatic-empty-test-dir";
    mkdirSync(emptyDir, { recursive: true });

    try {
      expect(() => {
        findProjectRoot(".", emptyDir);
      }).toThrow("No se pudo encontrar la raíz de un proyecto Bustatic");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("VirtualFileSystem (VFS)", () => {
  const exampleDir = join(import.meta.dir, "../examples/simple");

  test("indexes project files in memory", () => {
    const vfs = new VirtualFileSystem(exampleDir);
    expect(vfs.hasFile(join(exampleDir, "src/components/card.html"))).toBe(true);
    expect(vfs.hasFile(join(exampleDir, "src/data/features.json"))).toBe(true);
    expect(vfs.hasFile(join(exampleDir, "non-existent-file.html"))).toBe(false);
  });

  test("resolves root-relative (/components/card.html) and relative paths (../components/card.html)", () => {
    const vfs = new VirtualFileSystem(exampleDir);
    const pageFile = join(exampleDir, "src/pages/index.html");
    const componentsDir = join(exampleDir, "src/components");

    // 1. Root-relative
    const rootRel = vfs.resolvePath("/components/card.html", pageFile, componentsDir);
    expect(rootRel).toBe(join(exampleDir, "src/components/card.html"));

    // 2. Relative from page
    const rel = vfs.resolvePath("../components/card.html", pageFile, componentsDir);
    expect(rel).toBe(join(exampleDir, "src/components/card.html"));

    // 3. Bare convention name
    const bare = vfs.resolvePath("card.html", pageFile, componentsDir);
    expect(bare).toBe(join(exampleDir, "src/components/card.html"));
  });

  test("caches content in RAM and invalidates on change", async () => {
    const fixtureDir = "/tmp/bustatic-vfs-cache-test";
    mkdirSync(join(fixtureDir, "components"), { recursive: true });
    const compFile = join(fixtureDir, "components/test.html");
    await Bun.write(compFile, "<div>Initial Version</div>");

    const vfs = new VirtualFileSystem(fixtureDir);

    // First read
    const text1 = await vfs.readText(compFile);
    expect(text1).toBe("<div>Initial Version</div>");

    // Modify file on disk directly
    await Bun.write(compFile, "<div>Updated Version</div>");

    // Without invalidation, cache still returns text1
    const textCached = await vfs.readText(compFile);
    expect(textCached).toBe("<div>Initial Version</div>");

    // Invalidate
    vfs.invalidateFile(compFile);

    // Now returns updated version
    const textUpdated = await vfs.readText(compFile);
    expect(textUpdated).toBe("<div>Updated Version</div>");

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
