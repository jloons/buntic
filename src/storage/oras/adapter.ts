import type { StorageAssetResult, StorageLoaderFn } from "../../types.ts";
import { OrasClient } from "./client.ts";
import type { OrasStorageOptions } from "./types.ts";

/**
 * Creates a Buntic storage loader function backed by an OCI Registry / ORAS.
 *
 * @example
 * ```ts
 * // storage/oci.ts
 * import { createOrasStorage } from "buntic";
 *
 * export default createOrasStorage({
 *   hostname: "localhost:5000",
 *   insecure: true,
 * });
 * ```
 */
export function createOrasStorage(options: OrasStorageOptions): StorageLoaderFn {
  const client = new OrasClient(options);
  const defaultTag = options.defaultTag || "latest";
  const prefix = options.prefix ? options.prefix.replace(/\/+$/, "") : undefined;

  return async (key: string): Promise<StorageAssetResult> => {
    let cleanKey = key.trim();

    // If prefix is configured and key doesn't start with prefix, prepend it
    let target = cleanKey;
    if (prefix && !cleanKey.includes("://") && !cleanKey.startsWith(prefix + "/")) {
      target = `${prefix}/${cleanKey}`;
    }

    const ref = client.resolveRef(target);
    if (!ref.tag && !ref.digest) {
      ref.tag = defaultTag;
    }

    // Validate OCI repository name lowercase rule
    if (ref.repository !== ref.repository.toLowerCase()) {
      console.warn(
        `\x1b[33m⚠ [Buntic ORAS Warning]\x1b[0m OCI repository names must be lowercase. Converting "${ref.repository}" to "${ref.repository.toLowerCase()}".`
      );
      ref.repository = ref.repository.toLowerCase();
    }

    const artifact = await client.getArtifactStream(ref, ref.subpath);
    const bytes = await new Response(artifact.stream).bytes();

    return {
      bytes,
      etag: artifact.digest,
      contentType: artifact.mediaType,
    };
  };
}
