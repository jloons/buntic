import { resolve, join, dirname, basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { BunticConfig, ResolvedConfig } from "./types.ts";
import { registerBunticModuleResolver } from "./runtime.ts";

export function defineConfig(config: BunticConfig): BunticConfig {
  return config;
}

/**
 * Discovers the Buntic project root:
 * 1. If an explicit target directory is passed, verifies its existence.
 * 2. If no target (or ".") is passed, walks up from startCwd until it finds
 *    either a "pages" (or "src/pages") directory or a "buntic.config.*" file.
 * 3. Throws a helpful, actionable error if no root is detected.
 */
export function findProjectRoot(cliTarget?: string, startCwd = process.cwd()): string {
  if (cliTarget && cliTarget !== ".") {
    const target = resolve(startCwd, cliTarget);
    if (!existsSync(target)) {
      throw new Error(`[Buntic] Specified project directory does not exist: "${target}"`);
    }
    return target;
  }

  let current = resolve(startCwd);
  while (true) {
    const hasConfig =
      existsSync(join(current, "buntic.config.ts")) ||
      existsSync(join(current, "buntic.config.js")) ||
      existsSync(join(current, "buntic.config.json"));

    if (hasConfig) {
      return current;
    }

    const srcPagesDir = join(current, "src", "pages");
    if (existsSync(srcPagesDir) && statSync(srcPagesDir).isDirectory()) {
      return current;
    }

    const pagesDir = join(current, "pages");
    if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
      // If the current folder is named "src", the actual project root is its parent directory
      if (basename(current) === "src") {
        return dirname(current);
      }
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    `[Buntic Error]: Could not find a Buntic project root.\n` +
    `  Searched in: ${startCwd} (and parent directories)\n\n` +
    `👉 How to fix this:\n` +
    `  1. Ensure you have a "pages/" or "src/pages/" directory with at least one .html file.\n` +
    `  2. Or pass the project path explicitly:\n` +
    `     $ buntic dev <directory>   (e.g. buntic dev examples/simple)\n` +
    `  3. Or create a "buntic.config.ts" / "buntic.config.json" configuration file (or run "buntic init").`
  );
}

export async function resolveConfig(
  cliRootDir = ".",
  overrides: Partial<BunticConfig> = {}
): Promise<ResolvedConfig> {
  const root = findProjectRoot(cliRootDir);

  let userConfig: BunticConfig = {};

  const tsConfigPath = join(root, "buntic.config.ts");
  const jsConfigPath = join(root, "buntic.config.js");
  const jsonConfigPath = join(root, "buntic.config.json");

  if (existsSync(tsConfigPath)) {
    registerBunticModuleResolver(root);
    const mod = await import(tsConfigPath);
    userConfig = mod.default || mod;
  } else if (existsSync(jsConfigPath)) {
    registerBunticModuleResolver(root);
    const mod = await import(jsConfigPath);
    userConfig = mod.default || mod;
  } else if (existsSync(jsonConfigPath)) {
    const file = Bun.file(jsonConfigPath);
    userConfig = await file.json();
  }

  const merged: BunticConfig = {
    ...userConfig,
    ...overrides,
  };

  const hasSrcDir = existsSync(join(root, "src")) && statSync(join(root, "src")).isDirectory();
  const pickDir = (name: string, checkRootFirst = false): string => {
    if (checkRootFirst) {
      if (existsSync(join(root, name))) return name;
      if (hasSrcDir && existsSync(join(root, "src", name))) return join("src", name);
      return name;
    }
    if (hasSrcDir && existsSync(join(root, "src", name))) {
      return join("src", name);
    }
    return name;
  };

  return {
    root,
    pagesDir: resolve(root, merged.pagesDir ?? pickDir("pages")),
    layoutsDir: resolve(root, merged.layoutsDir ?? pickDir("layouts")),
    componentsDir: resolve(root, merged.componentsDir ?? pickDir("components")),
    dataDir: resolve(root, merged.dataDir ?? pickDir("data")),
    publicDir: resolve(root, merged.publicDir ?? pickDir("public", true)),
    storageDir: resolve(root, merged.storageDir ?? pickDir("storage")),
    cacheDir: resolve(root, merged.cacheDir ?? ".buntic/cache/images"),
    outDir: resolve(root, merged.outDir ?? "dist"),
    port: merged.port ?? 3000,
    minify: merged.minify ?? true,
    cssStrategy: merged.cssStrategy ?? "inline",
    site: merged.site,
    seo: merged.seo,
    feeds: merged.feeds,
    defaultStorage: merged.defaultStorage,
  };
}
