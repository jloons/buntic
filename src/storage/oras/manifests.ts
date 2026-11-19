import type { OCIDescriptor, OCIManifest } from "./types.ts";
import { ANNOTATIONS, MEDIA_TYPES } from "./types.ts";

export const EMPTY_CONFIG_CONTENT = "{}";
export const EMPTY_CONFIG_DIGEST =
  "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
export const EMPTY_CONFIG_SIZE = 2;

/**
 * Creates the standard empty config descriptor for OCI artifacts.
 */
export function createEmptyConfigDescriptor(
  mediaType: string = MEDIA_TYPES.OCI_EMPTY_CONFIG_V1
): OCIDescriptor {
  return {
    mediaType,
    digest: EMPTY_CONFIG_DIGEST,
    size: EMPTY_CONFIG_SIZE,
    data: btoa(EMPTY_CONFIG_CONTENT),
  };
}

/**
 * Computes sha256 digest string for a string or Uint8Array.
 */
export function hashData(data: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return `sha256:${hasher.digest("hex")}`;
}

/**
 * Computes sha256 digest and size of a file on disk using Bun.file().
 */
export async function hashFile(
  filePath: string
): Promise<{ digest: string; size: number }> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  const size = file.size;
  const hasher = new Bun.CryptoHasher("sha256");

  const stream = file.stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }

  const digest = `sha256:${hasher.digest("hex")}`;
  return { digest, size };
}

/**
 * Guesses or resolves a media type based on file extension.
 */
export function guessMediaType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".obj")) return "model/obj";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz"))
    return "application/x-gzip";
  if (lower.endsWith(".tar")) return "application/x-tar";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return MEDIA_TYPES.DEFAULT_BLOB_TYPE;
}

/**
 * Builds an OCIDescriptor for a layer.
 */
export function createLayerDescriptor(options: {
  digest: string;
  size: number;
  mediaType?: string;
  filename?: string;
  annotations?: Record<string, string>;
}): OCIDescriptor {
  const annotations: Record<string, string> = {
    ...options.annotations,
  };

  if (options.filename && !annotations[ANNOTATIONS.TITLE]) {
    annotations[ANNOTATIONS.TITLE] = options.filename;
  }

  return {
    mediaType:
      options.mediaType ||
      (options.filename ? guessMediaType(options.filename) : MEDIA_TYPES.DEFAULT_BLOB_TYPE),
    digest: options.digest,
    size: options.size,
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
  };
}

/**
 * Assembles a standard OCI Image Manifest v1.
 */
export function buildManifest(options: {
  config?: OCIDescriptor;
  layers: OCIDescriptor[];
  artifactType?: string;
  annotations?: Record<string, string>;
}): OCIManifest {
  return {
    schemaVersion: 2,
    mediaType: MEDIA_TYPES.OCI_IMAGE_MANIFEST_V1,
    artifactType: options.artifactType,
    config: options.config || createEmptyConfigDescriptor(),
    layers: options.layers,
    annotations: options.annotations,
  };
}
