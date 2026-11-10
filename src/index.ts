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
export { SeoMetadataEngine } from "./seo/metadata.ts";
export { generateSitemapXml } from "./seo/sitemap.ts";
export { generateRobotsTxt } from "./seo/robots.ts";
export { generateRss2Xml, generateAtomXml, extractFeedEntries } from "./seo/feeds.ts";

export { Builder, type BuildResult, type BuildOptions } from "./builder/builder.ts";
export { startDevServer, type DevServerInstance } from "./server/dev.ts";
export { runCLI } from "./cli.ts";

/**
 * Programmatic helper to build a site.
 */
export async function build(dir = ".", overrides = {}, options = {}) {
  const { resolveConfig } = await import("./config.ts");
  const { Builder } = await import("./builder/builder.ts");
  const config = await resolveConfig(dir, overrides);
  const builder = new Builder(config);
  return builder.build(options);
}

/**
 * Programmatic helper to start dev server.
 */
export async function dev(dir = ".", overrides = {}) {
  const { resolveConfig } = await import("./config.ts");
  const { startDevServer } = await import("./server/dev.ts");
  const config = await resolveConfig(dir, overrides);
  return startDevServer(config);
}
