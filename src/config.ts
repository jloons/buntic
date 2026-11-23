import { resolve, join, dirname, basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { BustaticConfig, ResolvedConfig } from "./types.ts";
import { registerBustaticModuleResolver } from "./runtime.ts";

export function defineConfig(config: BustaticConfig): BustaticConfig {
  return config;
}

/**
 * Discovers the Bustatic project root:
 * 1. If an explicit target directory is passed, verifies its existence.
 * 2. If no target (or ".") is passed, walks up from startCwd until it finds
 *    either a "pages" (or "src/pages") directory or a "bustatic.config.*" file.
 * 3. Throws a helpful, actionable error if no root is detected.
 */
export function findProjectRoot(cliTarget?: string, startCwd = process.cwd()): string {
  if (cliTarget && cliTarget !== ".") {
    const target = resolve(startCwd, cliTarget);
    if (!existsSync(target)) {
      throw new Error(`[Bustatic] Specified project directory does not exist: "${target}"`);
    }
    return target;
  }

  let current = resolve(startCwd);
  while (true) {
    const hasConfig =
      existsSync(join(current, "bustatic.config.ts")) ||
      existsSync(join(current, "bustatic.config.js")) ||
      existsSync(join(current, "bustatic.config.json"));

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
    `[Bustatic Error]: Could not find a Bustatic project root.\n` +
    `  Searched in: ${startCwd} (and parent directories)\n\n` +
    `👉 How to fix this:\n` +
    `  1. Ensure you have a "pages/" or "src/pages/" directory with at least one .html file.\n` +
    `  2. Or pass the project path explicitly:\n` +
    `     $ bustatic dev <directory>   (e.g. bustatic dev examples/simple)\n` +
    `  3. Or create a "bustatic.config.ts" / "bustatic.config.json" configuration file (or run "bustatic init").`
  );
}

export async function resolveConfig(
  cliRootDir = ".",
  overrides: Partial<BustaticConfig> = {}
): Promise<ResolvedConfig> {
  const root = findProjectRoot(cliRootDir);

  let userConfig: BustaticConfig = {};

  const tsConfigPath = join(root, "bustatic.config.ts");
  const jsConfigPath = join(root, "bustatic.config.js");
  const jsonConfigPath = join(root, "bustatic.config.json");

  if (existsSync(tsConfigPath)) {
    registerBustaticModuleResolver(root);
    const mod = await import(tsConfigPath);
    userConfig = mod.default || mod;
  } else if (existsSync(jsConfigPath)) {
    registerBustaticModuleResolver(root);
    const mod = await import(jsConfigPath);
    userConfig = mod.default || mod;
  } else if (existsSync(jsonConfigPath)) {
    const file = Bun.file(jsonConfigPath);
    userConfig = await file.json();
  }

  const merged: BustaticConfig = {
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
    cacheDir: resolve(root, merged.cacheDir ?? ".bustatic/cache/images"),
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
