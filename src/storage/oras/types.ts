/**
 * Standard OCI and ORAS media types.
 */
export const MEDIA_TYPES = {
  // OCI Manifests
  OCI_IMAGE_MANIFEST_V1: "application/vnd.oci.image.manifest.v1+json",
  OCI_IMAGE_INDEX_V1: "application/vnd.oci.image.index.v1+json",
  DOCKER_MANIFEST_V2: "application/vnd.docker.distribution.manifest.v2+json",

  // OCI Configs
  OCI_EMPTY_CONFIG_V1: "application/vnd.oci.empty.v1+json",
  OCI_IMAGE_CONFIG_V1: "application/vnd.oci.image.config.v1+json",

  // OCI Layers / Artifacts
  OCI_LAYER_TAR: "application/vnd.oci.image.layer.v1.tar",
  OCI_LAYER_TAR_GZIP: "application/vnd.oci.image.layer.v1.tar+gzip",
  ORAS_DEFAULT_LAYER: "application/vnd.oci.image.layer.v1.tar",
  DEFAULT_BLOB_TYPE: "application/octet-stream",
} as const;

/**
 * Standard OCI annotations keys.
 */
export const ANNOTATIONS = {
  TITLE: "org.opencontainers.image.title",
  CREATED: "org.opencontainers.image.created",
  DESCRIPTION: "org.opencontainers.image.description",
  VENDOR: "org.opencontainers.image.vendor",
  VERSION: "org.opencontainers.image.version",
} as const;

/**
 * OCI Content Descriptor
 */
export interface OCIDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  urls?: string[];
  annotations?: Record<string, string>;
  data?: string;
}

/**
 * OCI Image Manifest Spec (v1)
 */
export interface OCIManifest {
  schemaVersion: number;
  mediaType?: string;
  artifactType?: string;
  config: OCIDescriptor;
  layers: OCIDescriptor[];
  subject?: OCIDescriptor;
  annotations?: Record<string, string>;
}

/**
 * Parsed container/artifact target reference.
 * Example: "reg:5000/namespace/repo:tag" or "reg:5000/repo@sha256:..."
 */
export interface OCIReference {
  raw: string;
  registry: string;
  repository: string;
  tag?: string;
  digest?: string;
  subpath?: string;
}

/**
 * Client authentication credentials.
 */
export interface BasicAuth {
  username: string;
  password: string;
}

export interface TokenAuth {
  token: string;
}

export type AuthCredentials = BasicAuth | TokenAuth;

/**
 * Options for instantiating OrasClient.
 */
export interface OrasClientOptions {
  /**
   * Default registry hostname (e.g. "localhost:5000" or "ghcr.io").
   * Can also be inferred from the target string in push/pull.
   */
  hostname?: string;

  /**
   * When true, uses HTTP instead of HTTPS (ideal for local development).
   * Default: false (HTTPS).
   */
  insecure?: boolean;

  /**
   * Authentication credentials (Basic username/password or Bearer token).
   */
  auth?: AuthCredentials;

  /**
   * Custom headers to send with each request.
   */
  headers?: Record<string, string>;
}

/**
 * Options for createOrasStorage helper.
 */
export interface OrasStorageOptions extends OrasClientOptions {
  /**
   * Optional repository prefix (e.g. "catalog" -> "<host>/catalog/<key>").
   */
  prefix?: string;

  /**
   * Default tag if none specified in key (default: "latest").
   */
  defaultTag?: string;
}

/**
 * High-level Push parameters.
 */
export interface PushOptions {
  /** Target reference: e.g. "reg:5000/my-app/media:v1" */
  target: string;

  /** Local file paths to upload as layers */
  files?: string[];

  /** Optional custom media type for the config descriptor */
  configMediaType?: string;

  /** Optional config content as JSON object */
  config?: Record<string, any>;

  /** Custom annotations for the manifest */
  manifestAnnotations?: Record<string, string>;

  /** Custom annotations mapped by file path or filename */
  fileAnnotations?: Record<string, Record<string, string>>;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  target: OCIReference;
  digest: string;
  size: number;
  layers: OCIDescriptor[];
}

/**
 * High-level Pull parameters.
 */
export interface PullOptions {
  /** Target reference: e.g. "reg:5000/my-app/media:v1" or "@sha256:..." */
  target: string;

  /** Directory where downloaded files should be saved */
  outdir: string;

  /** If true, will overwrite existing files */
  overwrite?: boolean;
}

/**
 * Result of a pull operation.
 */
export interface PullResult {
  manifest: OCIManifest;
  files: string[];
}

/**
 * In-memory or streaming blob response.
 */
export interface BlobStreamResult {
  digest: string;
  size: number;
  mediaType: string;
  filename?: string;
  annotations?: Record<string, string>;
  stream: ReadableStream<Uint8Array>;
}
