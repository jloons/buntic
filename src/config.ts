import { resolve, join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { BustaticConfig, ResolvedConfig } from "./types.ts";

export function defineConfig(config: BustaticConfig): BustaticConfig {
  return config;
}

/**
 * Discovers the Bustatic project root:
 * 1. If an explicit target directory is passed, verifies its existence.
 * 2. If no target (or ".") is passed, walks up from startCwd until it finds
 *    either a "pages" directory or a "bustatic.config.*" file.
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
    const pagesDir = join(current, "pages");
    const hasPages = existsSync(pagesDir) && statSync(pagesDir).isDirectory();
    const hasConfig =
      existsSync(join(current, "bustatic.config.ts")) ||
      existsSync(join(current, "bustatic.config.js")) ||
      existsSync(join(current, "bustatic.config.json"));

    if (hasPages || hasConfig) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(
    `[Bustatic Error]: No se pudo encontrar la raíz de un proyecto Bustatic.\n` +
    `  Buscado en: ${startCwd} (y directorios superiores)\n\n` +
    `👉 ¿Cómo solucionarlo?\n` +
    `  1. Asegúrate de tener una carpeta "pages/" con al menos un archivo .html.\n` +
    `  2. O especifica la ruta de tu proyecto explícitamente:\n` +
    `     $ bustatic dev <directorio>   (ej: bustatic dev example)\n` +
    `  3. O crea un archivo de configuración "bustatic.config.json".`
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
    cssStrategy: merged.cssStrategy ?? "inline",
  };
}
