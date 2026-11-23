import { isPathInside } from "../../utils/paths.ts";
import { AuthManager } from "./auth.ts";
import {
  buildManifest,
  createEmptyConfigDescriptor,
  createLayerDescriptor,
  EMPTY_CONFIG_CONTENT,
  EMPTY_CONFIG_DIGEST,
  EMPTY_CONFIG_SIZE,
  hashData,
  hashFile,
} from "./manifests.ts";
import { parseOciReference } from "./reference.ts";
import type {
  BlobStreamResult,
  OCIDescriptor,
  OCIManifest,
  OCIReference,
  OrasClientOptions,
  PullOptions,
  PullResult,
  PushOptions,
  PushResult,
} from "./types.ts";
import { ANNOTATIONS, MEDIA_TYPES } from "./types.ts";
import { join } from "node:path";

export class OrasClient {
  private hostname?: string;
  private insecure: boolean;
  private authManager: AuthManager;
  private defaultHeaders: Record<string, string>;

  constructor(options: OrasClientOptions = {}) {
    this.hostname = options.hostname;
    this.insecure = options.insecure ?? false;
    this.authManager = new AuthManager(options.auth);
    this.defaultHeaders = options.headers || {};
  }

  /**
   * Builds the base URL for a given registry hostname.
   */
  private getBaseUrl(registry?: string): string {
    const host = registry || this.hostname;
    if (!host) {
      throw new Error("Registry hostname not specified in target or client options");
    }
    const cleanHost = host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const scheme = this.insecure ? "http" : "https";
    return `${scheme}://${cleanHost}`;
  }

  private buildRepoUrl(ref: OCIReference, suffix: string): string {
    return `${this.getBaseUrl(ref.registry)}/v2/${ref.repository}${suffix}`;
  }

  private async assertOk(res: Response, action: string, includeBody = false): Promise<void> {
    if (res.ok) return;
    if (includeBody) {
      const errText = await res.text();
      throw new Error(`${action}: HTTP ${res.status} - ${errText}`);
    }
    throw new Error(`${action}: HTTP ${res.status} ${res.statusText}`);
  }

  /**
   * Resolves an input target string or OCIReference into an OCIReference object.
   */
  public resolveRef(target: string | OCIReference): OCIReference {
    if (typeof target === "string") {
      return parseOciReference(target, this.hostname);
    }
    return target;
  }

  /**
   * Internal fetch wrapper that automatically handles authentication challenges (401).
   */
  async request(
    url: string,
    init: RequestInit = {},
    scope?: string
  ): Promise<Response> {
    const headers = new Headers(init.headers || {});

    // Set default headers if not overridden
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }

    // Set initial auth header if available and not yet set
    if (!headers.has("Authorization")) {
      const initialAuth = this.authManager.getInitialAuthHeader();
      if (initialAuth) {
        headers.set("Authorization", initialAuth);
      }
    }

    let response = await fetch(url, { ...init, headers });

    // Handle 401 Unauthorized challenge
    if (response.status === 401) {
      const wwwAuth = response.headers.get("www-authenticate");
      if (wwwAuth) {
        const retryAuthHeader = await this.authManager.handleChallenge(
          wwwAuth,
          scope
        );
        if (retryAuthHeader) {
          headers.set("Authorization", retryAuthHeader);
          response = await fetch(url, { ...init, headers });
        }
      }
    }

    return response;
  }

  /**
   * Checks if the registry endpoint /v2/ is reachable.
   */
  async ping(registry?: string): Promise<boolean> {
    const base = this.getBaseUrl(registry);
    try {
      const res = await this.request(`${base}/v2/`);
      return res.status === 200 || res.status === 401;
    } catch {
      return false;
    }
  }

  // ==========================================
  // Blobs API
  // ==========================================

  /**
   * Checks if a blob exists in the repository (HEAD /v2/<repo>/blobs/<digest>).
   */
  async hasBlob(
    target: string | OCIReference,
    digest: string
  ): Promise<boolean> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, `/blobs/${digest}`);
    const scope = `repository:${ref.repository}:pull`;

    const res = await this.request(url, { method: "HEAD" }, scope);
    return res.status === 200;
  }

  /**
   * Retrieves a blob as a raw streaming HTTP response (GET /v2/<repo>/blobs/<digest>).
   */
  async getBlobStream(
    target: string | OCIReference,
    digest: string
  ): Promise<Response> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, `/blobs/${digest}`);
    const scope = `repository:${ref.repository}:pull`;

    const res = await this.request(url, { method: "GET" }, scope);
    await this.assertOk(res, `Failed to get blob ${digest}`);
    return res;
  }

  /**
   * Uploads a blob stream using OCI monolithic upload.
   */
  async uploadBlobStream(
    target: string | OCIReference,
    body: BodyInit,
    size: number,
    digest: string
  ): Promise<void> {
    const ref = this.resolveRef(target);

    // Skip if blob already exists
    if (await this.hasBlob(ref, digest)) {
      return;
    }

    const base = this.getBaseUrl(ref.registry);
    const initUrl = this.buildRepoUrl(ref, "/blobs/uploads/");
    const scope = `repository:${ref.repository}:pull,push`;

    // 1. Initiate upload
    const initRes = await this.request(initUrl, { method: "POST" }, scope);
    if (initRes.status !== 202) {
      throw new Error(
        `Failed to initiate blob upload: HTTP ${initRes.status} ${initRes.statusText}`
      );
    }

    const locationHeader = initRes.headers.get("location");
    if (!locationHeader) {
      throw new Error("Registry did not return Location header for blob upload");
    }

    const uploadUrl = new URL(locationHeader, base);
    uploadUrl.searchParams.set("digest", digest);

    // 2. Put blob contents
    const putRes = await this.request(
      uploadUrl.toString(),
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": size.toString(),
        },
        body,
      },
      scope
    );

    if (putRes.status !== 201) {
      const errText = await putRes.text();
      throw new Error(
        `Failed to complete blob upload (${digest}): HTTP ${putRes.status} - ${errText}`
      );
    }
  }

  /**
   * Uploads a local file as an OCI blob using native Bun.file().
   */
  async uploadBlobFile(
    target: string | OCIReference,
    filePath: string,
    options: { mediaType?: string; filename?: string } = {}
  ): Promise<OCIDescriptor> {
    const ref = this.resolveRef(target);
    const { digest, size } = await hashFile(filePath);

    const file = Bun.file(filePath);
    const filename = options.filename || filePath.split("/").pop() || "file";

    await this.uploadBlobStream(ref, file.stream(), size, digest);

    return createLayerDescriptor({
      digest,
      size,
      mediaType: options.mediaType,
      filename,
    });
  }

  /**
   * Deletes a blob by its digest.
   */
  async deleteBlob(
    target: string | OCIReference,
    digest: string
  ): Promise<boolean> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, `/blobs/${digest}`);
    const scope = `repository:${ref.repository}:pull,push,*`;

    const res = await this.request(url, { method: "DELETE" }, scope);
    return res.status === 202 || res.status === 200;
  }

  // ==========================================
  // Manifests & Tags API
  // ==========================================

  /**
   * Retrieves an OCI Image Manifest.
   */
  async getManifest(
    target: string | OCIReference,
    tagOrDigest?: string
  ): Promise<OCIManifest> {
    const ref = this.resolveRef(target);
    const reference = tagOrDigest || ref.digest || ref.tag || "latest";
    const url = this.buildRepoUrl(ref, `/manifests/${reference}`);
    const scope = `repository:${ref.repository}:pull`;

    const res = await this.request(
      url,
      {
        headers: {
          Accept: `${MEDIA_TYPES.OCI_IMAGE_MANIFEST_V1}, ${MEDIA_TYPES.DOCKER_MANIFEST_V2}`,
        },
      },
      scope
    );

    await this.assertOk(res, `Failed to get manifest ${reference}`);

    return (await res.json()) as OCIManifest;
  }

  /**
   * Puts an OCI Image Manifest onto the registry.
   */
  async putManifest(
    target: string | OCIReference,
    tagOrDigest: string,
    manifest: OCIManifest
  ): Promise<{ digest: string }> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, `/manifests/${tagOrDigest}`);
    const scope = `repository:${ref.repository}:pull,push`;

    const body = JSON.stringify(manifest);
    const digest = hashData(body);

    const res = await this.request(
      url,
      {
        method: "PUT",
        headers: {
          "Content-Type":
            manifest.mediaType || MEDIA_TYPES.OCI_IMAGE_MANIFEST_V1,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
        body,
      },
      scope
    );

    if (res.status !== 201 && res.status !== 200) {
      const err = await res.text();
      throw new Error(
        `Failed to put manifest ${tagOrDigest}: HTTP ${res.status} - ${err}`
      );
    }

    const resDigest = res.headers.get("docker-content-digest") || digest;
    return { digest: resDigest };
  }

  /**
   * Lists tags for a given repository.
   */
  async getTags(target: string | OCIReference): Promise<string[]> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, "/tags/list");
    const scope = `repository:${ref.repository}:pull`;

    const res = await this.request(url, {}, scope);
    await this.assertOk(res, `Failed to list tags for ${ref.repository}`);

    const data = (await res.json()) as { tags?: string[] };
    return data.tags || [];
  }

  /**
   * Deletes a manifest reference by tag or digest.
   */
  async deleteManifest(
    target: string | OCIReference,
    tagOrDigest: string
  ): Promise<boolean> {
    const ref = this.resolveRef(target);
    const url = this.buildRepoUrl(ref, `/manifests/${tagOrDigest}`);
    const scope = `repository:${ref.repository}:pull,push,*`;

    const res = await this.request(url, { method: "DELETE" }, scope);
    return res.status === 202 || res.status === 200;
  }

  // ==========================================
  // High-Level ORAS Operations
  // ==========================================

  /**
   * Pushes files as an OCI artifact.
   */
  async push(options: PushOptions): Promise<PushResult> {
    const ref = this.resolveRef(options.target);
    const files = options.files || [];

    // 1. Upload layers
    const layers: OCIDescriptor[] = [];
    for (const filePath of files) {
      const filename = filePath.split("/").pop() || "file";
      const customAnnotations =
        options.fileAnnotations?.[filePath] ||
        options.fileAnnotations?.[filename];

      const desc = await this.uploadBlobFile(ref, filePath, {
        filename,
      });

      if (customAnnotations) {
        desc.annotations = {
          ...desc.annotations,
          ...customAnnotations,
        };
      }

      layers.push(desc);
    }

    // 2. Upload config descriptor (empty config by default)
    let configDesc: OCIDescriptor;
    if (options.config) {
      const configStr = JSON.stringify(options.config);
      const configDigest = hashData(configStr);
      const configSize = Buffer.byteLength(configStr);
      await this.uploadBlobStream(
        ref,
        configStr,
        configSize,
        configDigest
      );
      configDesc = {
        mediaType:
          options.configMediaType || MEDIA_TYPES.OCI_IMAGE_CONFIG_V1,
        digest: configDigest,
        size: configSize,
      };
    } else {
      await this.uploadBlobStream(
        ref,
        EMPTY_CONFIG_CONTENT,
        EMPTY_CONFIG_SIZE,
        EMPTY_CONFIG_DIGEST
      );
      configDesc = createEmptyConfigDescriptor(
        options.configMediaType || MEDIA_TYPES.OCI_EMPTY_CONFIG_V1
      );
    }

    // 3. Build & push manifest
    const manifest = buildManifest({
      config: configDesc,
      layers,
      annotations: options.manifestAnnotations,
    });

    const tag = ref.tag || "latest";
    const { digest } = await this.putManifest(ref, tag, manifest);

    const totalSize = layers.reduce((acc, l) => acc + l.size, 0);

    return {
      target: ref,
      digest,
      size: totalSize,
      layers,
    };
  }

  /**
   * Pulls an OCI artifact and writes its layers to disk.
   */
  async pull(options: PullOptions): Promise<PullResult> {
    const ref = this.resolveRef(options.target);
    const manifest = await this.getManifest(ref);

    const downloadedFiles: string[] = [];

    for (const layer of manifest.layers) {
      const title =
        layer.annotations?.[ANNOTATIONS.TITLE] ||
        layer.digest.replace("sha256:", "");
      const outPath = join(options.outdir, title);

      if (!isPathInside(options.outdir, outPath) || outPath === join(options.outdir)) {
        throw new Error(
          `[Bustatic Security Error] Unsafe OCI layer title "${title}" escapes output directory "${options.outdir}".`
        );
      }

      const res = await this.getBlobStream(ref, layer.digest);
      if (!res.body) {
        throw new Error(`Empty response body for layer ${layer.digest}`);
      }

      await Bun.write(outPath, res.body);
      downloadedFiles.push(outPath);
    }

    return {
      manifest,
      files: downloadedFiles,
    };
  }

  /**
   * Retrieves an artifact directly as a stream without writing to disk.
   */
  async getArtifactStream(
    target: string | OCIReference,
    filename?: string
  ): Promise<BlobStreamResult> {
    const ref = this.resolveRef(target);
    const manifest = await this.getManifest(ref);

    const targetFilename = filename || ref.subpath;

    let layer: OCIDescriptor | undefined;

    if (targetFilename) {
      layer = manifest.layers.find(
        (l) => l.annotations?.[ANNOTATIONS.TITLE] === targetFilename
      );
      if (!layer) {
        throw new Error(`File '${targetFilename}' not found in artifact layers`);
      }
    } else {
      layer = manifest.layers[0];
      if (!layer) {
        throw new Error("Artifact manifest has no layers");
      }
    }

    const res = await this.getBlobStream(ref, layer.digest);
    if (!res.body) {
      throw new Error(`Empty response body for blob ${layer.digest}`);
    }

    return {
      digest: layer.digest,
      size: layer.size,
      mediaType: layer.mediaType,
      filename: layer.annotations?.[ANNOTATIONS.TITLE],
      annotations: layer.annotations,
      stream: res.body,
    };
  }

  /**
   * Retrieves the catalog of repositories from the registry (GET /v2/_catalog).
   */
  async getCatalog(registry?: string, n?: number): Promise<string[]> {
    const base = this.getBaseUrl(registry);
    const url = new URL(`${base}/v2/_catalog`);
    if (n) url.searchParams.set("n", n.toString());
    const scope = "registry:catalog:*";

    const res = await this.request(url.toString(), {}, scope);
    if (!res.ok) {
      throw new Error(
        `Failed to get catalog: HTTP ${res.status} ${res.statusText}`
      );
    }
    const data = (await res.json()) as { repositories?: string[] };
    return data.repositories || [];
  }
}
