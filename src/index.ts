import type { BustaticConfig } from "./types.ts";
import type { BuildOptions, BuildResult } from "./builder/builder.ts";
import type { DevServerInstance } from "./server/dev.ts";

export type {
  BustaticConfig,
  ResolvedConfig,
  PageInfo,
  PageRouteInfo,
  StaticPathResult,
  PaginateOptions,
  PaginatePage,
  SiteConfig,
  SeoConfig,
  SeoImageConfig,
  FeedsConfig,
  PageSeo,
  FeedItem,
  PhotoAttributes,
  StorageAssetResult,
  StorageLoaderFn,
} from "./types.ts";

export { defineConfig, resolveConfig, findProjectRoot } from "./config.ts";
export { TemplateEngine } from "./template/engine.ts";
export { loadPublicEnv, isReservedNamespace, parseEnvContent } from "./env.ts";
export {
  resolveAllRoutes,
  createPaginator,
  buildCleanUrl,
  validateRouteParams,
  extractRouteTokens,
  isDynamicPattern,
  findCoLocatedLoader,
} from "./router/routes.ts";

export { AssetCache } from "./assets/cache.ts";
export { ImageProcessor } from "./assets/image-processor.ts";
export { PhotoProcessor } from "./assets/photo-tag.ts";
export { StorageManager } from "./storage/loader.ts";
export {
  OrasClient,
  createOrasStorage,
  parseOciReference,
  formatOciReference,
  AuthManager,
  loadStoredCredentials,
  parseWwwAuthenticate,
  type OrasClientOptions,
  type OrasStorageOptions,
  type OCIReference,
  type OCIManifest,
  type OCIDescriptor,
  type PushOptions,
  type PushResult,
  type PullOptions,
  type PullResult,
  type BlobStreamResult,
  type AuthCredentials,
  type BasicAuth,
  type TokenAuth,
} from "./storage/oras/index.ts";
export { SeoMetadataEngine } from "./seo/metadata.ts";
export { generateSitemapXml } from "./seo/sitemap.ts";
export { generateRobotsTxt } from "./seo/robots.ts";
export { generateRss2Xml, generateAtomXml, extractFeedEntries } from "./seo/feeds.ts";

export {
  Builder,
  detectPublicCollisions,
  assertNoPublicCollisions,
  type BuildResult,
  type BuildOptions,
  type PublicCollision,
} from "./builder/builder.ts";
export { startDevServer, type DevServerInstance } from "./server/dev.ts";
export {
  initProject,
  AVAILABLE_TEMPLATES,
  type TemplateName,
  type InitProjectOptions,
  type InitProjectResult,
} from "./init.ts";
export {
  registerBustaticModuleResolver,
  syncProjectTypes,
} from "./runtime.ts";
export { runCLI } from "./cli.ts";

/**
 * Programmatic helper to build a site.
 */
export async function build(
  dir = ".",
  overrides: Partial<BustaticConfig> = {},
  options: BuildOptions = {}
): Promise<BuildResult> {
  const { resolveConfig } = await import("./config.ts");
  const { Builder } = await import("./builder/builder.ts");
  const config = await resolveConfig(dir, overrides);
  const builder = new Builder(config);
  return builder.build(options);
}

/**
 * Programmatic helper to start dev server.
 */
export async function dev(
  dir = ".",
  overrides: Partial<BustaticConfig> = {}
): Promise<DevServerInstance> {
  const { resolveConfig } = await import("./config.ts");
  const { startDevServer } = await import("./server/dev.ts");
  const config = await resolveConfig(dir, overrides);
  return startDevServer(config);
}
