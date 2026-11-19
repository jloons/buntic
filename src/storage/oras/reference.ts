import type { OCIReference } from "./types.ts";

/**
 * Parses a target string into an OCIReference object.
 * Examples:
 * - "localhost:5000/product/1/portrait:latest"
 * - "product/1/portrait:2020" (uses fallbackRegistry)
 * - "product/1/portrait" (defaults tag to "latest")
 * - "localhost:5000/media@sha256:45b23dee08af..."
 * - "product/1/gallery:v1#thumb.png" (extracts subpath)
 */
export function parseOciReference(
  target: string,
  fallbackRegistry?: string
): OCIReference {
  const raw = target.trim();

  // Strip protocol if user passed http:// or https://
  let clean = raw.replace(/^https?:\/\//i, "");

  // Check for fragment/subpath first (#filename)
  let subpath: string | undefined;
  const hashIdx = clean.indexOf("#");
  if (hashIdx !== -1) {
    subpath = clean.slice(hashIdx + 1);
    clean = clean.slice(0, hashIdx);
  }

  let digest: string | undefined;
  let tag: string | undefined;

  // Check for digest first (@sha256:...)
  const atIdx = clean.indexOf("@");
  if (atIdx !== -1) {
    digest = clean.slice(atIdx + 1);
    clean = clean.slice(0, atIdx);
  }

  // Check for tag (:tag)
  const colonIdx = clean.lastIndexOf(":");
  // Ensure the colon is not part of a host:port component (has no / after it)
  if (colonIdx !== -1 && !clean.slice(colonIdx).includes("/")) {
    tag = clean.slice(colonIdx + 1);
    clean = clean.slice(0, colonIdx);
  }

  // Now `clean` contains [registry/]repository
  const parts = clean.split("/");

  let registry: string;
  let repository: string;

  // The first component is a registry hostname if it contains '.' or ':' or is 'localhost'
  const first = parts[0];
  const isHost =
    first.includes(".") ||
    first.includes(":") ||
    first.toLowerCase() === "localhost";

  if (isHost && parts.length > 1) {
    registry = parts[0];
    repository = parts.slice(1).join("/");
  } else if (fallbackRegistry) {
    registry = fallbackRegistry.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    repository = parts.join("/");
  } else {
    // If only one part and no host, or no fallback
    if (isHost && parts.length === 1) {
      registry = parts[0];
      repository = "";
    } else {
      registry = "";
      repository = parts.join("/");
    }
  }

  // Default tag if neither tag nor digest was provided
  if (!tag && !digest) {
    tag = "latest";
  }

  return {
    raw,
    registry,
    repository,
    tag,
    digest,
    subpath,
  };
}

/**
 * Formats an OCIReference back into a canonical URI string.
 */
export function formatOciReference(ref: OCIReference): string {
  const base = ref.registry ? `${ref.registry}/${ref.repository}` : ref.repository;
  let result = base;
  if (ref.digest) {
    result = `${base}@${ref.digest}`;
  } else {
    result = `${base}:${ref.tag || "latest"}`;
  }
  if (ref.subpath) {
    result = `${result}#${ref.subpath}`;
  }
  return result;
}
