import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { PageRouteInfo, ResolvedConfig } from "../types.ts";
import { walkFiles } from "../utils/paths.ts";

export interface PublicCollision {
  type: "route" | "reserved-dir";
  publicPath: string;
  conflictWith: string;
  outputPath: string;
}

export function getDirectoryFiles(dir: string, baseDir = dir): string[] {
  return walkFiles(dir, {
    baseDir,
    relativeToBase: true,
  });
}

export function detectPublicCollisions(
  config: ResolvedConfig,
  routes: PageRouteInfo[]
): PublicCollision[] {
  if (!existsSync(config.publicDir)) {
    return [];
  }

  const publicFiles = getDirectoryFiles(config.publicDir);
  const collisions: PublicCollision[] = [];

  const routeOutputMap = new Map<string, PageRouteInfo>();
  for (const route of routes) {
    const relOut = relative(config.outDir, route.outputFilePath).replace(/\\/g, "/");
    routeOutputMap.set(relOut, route);
  }

  for (const relFile of publicFiles) {
    if (routeOutputMap.has(relFile)) {
      const route = routeOutputMap.get(relFile)!;
      collisions.push({
        type: "route",
        publicPath: relative(config.root, join(config.publicDir, relFile)),
        conflictWith: relative(config.root, route.templateFilePath),
        outputPath: relFile,
      });
    }

    if (relFile.startsWith("assets/images/") || relFile === "assets/images") {
      collisions.push({
        type: "reserved-dir",
        publicPath: relative(config.root, join(config.publicDir, relFile)),
        conflictWith: "assets/images/ (Reserved for Bustatic <photo> image optimization)",
        outputPath: relFile,
      });
    } else if (relFile.startsWith("assets/seo/") || relFile === "assets/seo") {
      collisions.push({
        type: "reserved-dir",
        publicPath: relative(config.root, join(config.publicDir, relFile)),
        conflictWith: "assets/seo/ (Reserved for Bustatic <seo> social cards)",
        outputPath: relFile,
      });
    }
  }

  return collisions;
}

export function assertNoPublicCollisions(
  config: ResolvedConfig,
  routes: PageRouteInfo[]
): void {
  const collisions = detectPublicCollisions(config, routes);
  if (collisions.length === 0) return;

  const details = collisions
    .map((c) => {
      if (c.type === "route") {
        return `  - Public file "${c.publicPath}" conflicts with page template "${c.conflictWith}" (both output to "${c.outputPath}").`;
      }
      return `  - Public file "${c.publicPath}" conflicts with reserved internal path "${c.conflictWith}".`;
    })
    .join("\n");

  throw new Error(
    `[Bustatic Collision Error]: Conflict detected between public/ files and build output:\n` +
      details +
      `\n\n👉 Action: Remove or rename conflicting files in "public/" or adjust page routes in "pages/".`
  );
}
