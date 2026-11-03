import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import type { BustaticConfig, ResolvedConfig } from "./types.ts";

export function defineConfig(config: BustaticConfig): BustaticConfig {
  return config;
}

export async function resolveConfig(
  cliRootDir = ".",
  overrides: Partial<BustaticConfig> = {}
): Promise<ResolvedConfig> {
  const root = resolve(process.cwd(), cliRootDir);

  let userConfig: BustaticConfig = {};

  const tsConfigPath = join(root, "bustatic.config.ts");
  const jsConfigPath = join(root, "bustatic.config.js");
  const jsonConfigPath = join(root, "bustatic.config.json");

  if (existsSync(tsConfigPath)) {
    const mod = await import(tsConfigPath);
    userConfig = mod.default || mod;
  } else if (existsSync(jsConfigPath)) {
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

  return {
    root,
    pagesDir: resolve(root, merged.pagesDir ?? "pages"),
    layoutsDir: resolve(root, merged.layoutsDir ?? "layouts"),
    componentsDir: resolve(root, merged.componentsDir ?? "components"),
    dataDir: resolve(root, merged.dataDir ?? "data"),
    publicDir: resolve(root, merged.publicDir ?? "public"),
    outDir: resolve(root, merged.outDir ?? "dist"),
    port: merged.port ?? 3000,
    minify: merged.minify ?? true,
  };
}
