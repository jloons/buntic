import { join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { StorageAssetResult } from "../../../../src/types.ts";

/**
 * Local file-based storage loader that reads from fixtures/images/
 * Supports keys like:
 * - "product/1/portrait" -> resolves to fixtures/images/product/1/portrait/latest.png
 * - "product/1/portrait:2020" -> resolves to fixtures/images/product/1/portrait/2020.png
 */
export default async function getLocalAsset(key: string): Promise<StorageAssetResult> {
  const catalogRoot = join(dirname(dirname(import.meta.dir)));
  const fixturesDir = join(catalogRoot, "fixtures", "images");

  let tag = "latest";
  let pathPart = key.trim();

  // Extract tag if present (e.g. ":2020")
  const colonIdx = pathPart.lastIndexOf(":");
  if (colonIdx !== -1 && !pathPart.slice(colonIdx).includes("/")) {
    tag = pathPart.slice(colonIdx + 1);
    pathPart = pathPart.slice(0, colonIdx);
  }

  // Remove leading slashes
  pathPart = pathPart.replace(/^\/+/, "");

  const extensions = [".png", ".jpg", ".jpeg", ".webp"];
  let targetFile: string | null = null;
  let extFound = ".png";

  for (const ext of extensions) {
    const candidate = join(fixturesDir, pathPart, `${tag}${ext}`);
    if (existsSync(candidate)) {
      targetFile = candidate;
      extFound = ext;
      break;
    }
  }

  if (!targetFile) {
    throw new Error(
      `[Catalog Local Storage] Asset not found for key "${key}" (looked in "${join(fixturesDir, pathPart, `${tag}.{png,jpg,webp}`)}")`
    );
  }

  const file = Bun.file(targetFile);
  const stats = statSync(targetFile);
  const bytes = await file.bytes();

  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };

  return {
    bytes,
    etag: `"${stats.mtimeMs}-${stats.size}"`,
    contentType: mimeMap[extFound] || "application/octet-stream",
  };
}
