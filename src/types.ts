export interface StorageAssetResult {
  bytes: Uint8Array;
  etag?: string;
  contentType?: string;
}

export type StorageLoaderFn = (
  key: string
) => Promise<StorageAssetResult | Uint8Array | Response | ArrayBuffer> | StorageAssetResult | Uint8Array | Response | ArrayBuffer;

export interface SeoImageConfig {
  src?: string;
  key?: string;
  storage?: string;
  alt?: string;
}

export interface PageSeo {
  title?: string;
  description?: string;
  image?: string | SeoImageConfig;
  url?: string;
  type?: string;
  twitterCard?: "summary" | "summary_large_image";
}

export interface FeedItem {
  title: string;
  description?: string;
  date?: string | Date;
  author?: string;
  url?: string;
}

export interface SiteConfig {
  url: string;
  title?: string;
  description?: string;
  defaultOgImage?: string | SeoImageConfig;
  defaultStorage?: string;
}

export interface SeoConfig {
  sitemap?: boolean;
  robots?: boolean | { allow?: string[]; disallow?: string[] };
}

export interface FeedsConfig {
  rss?: boolean | string; // true -> "rss.xml" or custom filename
  atom?: boolean | string; // true -> "atom.xml" or custom filename
  title?: string;
  description?: string;
  limit?: number;
}

export interface PhotoAttributes {
  src?: string;
  key?: string;
  storage?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  widths?: number[] | string;
  sizes?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  class?: string;
  style?: string;
  id?: string;
  [key: string]: any;
}

export interface BustaticConfig {
  root?: string;
  pagesDir?: string;
  layoutsDir?: string;
  componentsDir?: string;
  dataDir?: string;
  publicDir?: string;
  storageDir?: string;
  cacheDir?: string;
  outDir?: string;
  port?: number;
  minify?: boolean;
  cssStrategy?: "inline" | "external";
  site?: SiteConfig;
  seo?: SeoConfig;
  feeds?: FeedsConfig;
  defaultStorage?: string;
}

export interface ResolvedConfig {
  root: string;
  pagesDir: string;
  layoutsDir: string;
  componentsDir: string;
  dataDir: string;
  publicDir: string;
  storageDir: string;
  cacheDir: string;
  outDir: string;
  port: number;
  minify: boolean;
  cssStrategy: "inline" | "external";
  site?: SiteConfig;
  seo?: SeoConfig;
  feeds?: FeedsConfig;
  defaultStorage?: string;
}

export interface PageInfo {
  relativeFilePath: string; // e.g. "index.html" or "blog/post.html"
  absoluteFilePath: string;
  urlPath: string;          // e.g. "/" or "/blog/post"
  outputFilePath: string;   // e.g. "dist/index.html" or "dist/blog/post.html"
}

export interface StaticPathResult {
  params: Record<string, string | number>;
  props?: Record<string, any>;
  seo?: PageSeo;
  feed?: FeedItem;
}

export interface PaginateOptions {
  pageSize?: number;
  props?: Record<string, any>;
  seo?: PageSeo;
  feed?: FeedItem;
}

export interface PaginatePage<T = any> {
  data: T[];
  start: number;
  end: number;
  total: number;
  currentPage: number;
  size: number;
  lastPage: number;
  url: {
    current: string;
    prev: string | null;
    next: string | null;
  };
}

export interface PageRouteInfo {
  /** Relative path pattern, e.g. "blog/[slug].html" or "about.html" */
  patternRelativePath: string;
  /** Absolute file path of the HTML template */
  templateFilePath: string;
  /** Clean URL path, e.g. "/blog/mi-post" or "/" */
  urlPath: string;
  /** Output file path in outDir (Clean URL: dist/.../index.html) */
  outputFilePath: string;
  /** Route parameters, e.g. { slug: "mi-post" } */
  params: Record<string, string>;
  /** Properties passed to the template */
  props: Record<string, any>;
  /** Whether this is a dynamic route */
  isDynamic: boolean;
  /** SEO metadata for this route */
  seo?: PageSeo;
  /** Feed item metadata for this route */
  feed?: FeedItem;
}
