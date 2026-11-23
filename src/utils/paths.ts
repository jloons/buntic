import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ResolvedConfig } from "../types.ts";

/**
 * Returns true if `targetPath` resolves strictly inside `baseDir` (or equals `baseDir`).
 * Prevents path-traversal attacks via `..` segments or encoded slashes.
 */
export function isPathInside(baseDir: string, targetPath: string): boolean {
  const absBase = resolve(baseDir);
  const absTarget = resolve(targetPath);
  if (absTarget === absBase) return true;
  const rel = relative(absBase, absTarget);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel);
}

/**
 * Resolves a local asset reference (`src`) from either root/public (`/foo.png`) or relative to `fromFile`.
 */
export function resolveLocalAssetPath(
  config: ResolvedConfig,
  src: string,
  fromFile: string
): string {
  if (src.startsWith("/")) {
    const clean = src.slice(1);
    const fromPublic = join(config.publicDir, clean);
    if (existsSync(fromPublic)) {
      return fromPublic;
    }
    const fromRoot = join(config.root, clean);
    if (existsSync(fromRoot)) {
      return fromRoot;
    }
    const fromSrc = join(config.root, "src", clean);
    if (existsSync(fromSrc)) {
      return fromSrc;
    }
    return fromRoot;
  }

  return resolve(dirname(fromFile), src);
}

/**
 * Recursively collects file paths under `dir`, returning paths relative to `baseDir`
 * when `relativeOutput` is true, or absolute paths otherwise.
 */
export function walkFiles(
  dir: string,
  options: {
    baseDir?: string;
    relativeToBase?: boolean;
    ignoreDotfiles?: boolean;
    filter?: (absPath: string, entryName: string) => boolean;
  } = {}
): string[] {
  if (!existsSync(dir)) return [];

  const baseDir = options.baseDir ?? dir;
  const relativeToBase = options.relativeToBase ?? false;
  const ignoreDotfiles = options.ignoreDotfiles ?? false;
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (ignoreDotfiles && entry.startsWith(".")) continue;

    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      results.push(
        ...walkFiles(full, {
          ...options,
          baseDir,
        })
      );
    } else if (stat.isFile()) {
      if (options.filter && !options.filter(full, entry)) continue;
      results.push(
        relativeToBase ? relative(baseDir, full).replace(/\\/g, "/") : full
      );
    }
  }

  return results;
}
