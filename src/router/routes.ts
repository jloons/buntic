import { join, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import type {
  FeedItem,
  PageRouteInfo,
  PageSeo,
  PaginateOptions,
  PaginatePage,
  ResolvedConfig,
  StaticPathResult,
} from "../types.ts";
import { logError, logWarn } from "../utils/logger.ts";
import { walkFiles } from "../utils/paths.ts";

export interface StaticLoaderResult {
  props: Record<string, unknown>;
  seo?: PageSeo;
  feed?: FeedItem;
}

/**
 * Extracts parameter tokens from a route path, e.g. "blog/[slug].html" -> ["slug"]
 */
export function extractRouteTokens(routePattern: string): string[] {
  const matches = routePattern.match(/\[([a-zA-Z0-9_-]+)\]/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Checks whether a relative path contains dynamic parameter brackets.
 */
export function isDynamicPattern(routePattern: string): boolean {
  return /\[[a-zA-Z0-9_-]+\]/.test(routePattern);
}

/**
 * Finds a co-located data loader (.data.ts, .data.js, .data.mjs) for a given template file.
 */
export function findCoLocatedLoader(templateFilePath: string): string | null {
  const basePath = templateFilePath.replace(/\.html$/, "");
  const candidates = [
    `${basePath}.data.ts`,
    `${basePath}.data.js`,
    `${basePath}.data.mjs`,
  ];

  for (const cand of candidates) {
    if (existsSync(cand)) {
      return cand;
    }
  }

  return null;
}

/**
 * Executes a co-located static page data loader (`.data.ts` / `.data.js`) and normalizes
 * `{ props, seo, feed }` or plain object returns.
 */
export async function executeStaticLoader(
  loaderPath: string,
  globalData: Record<string, unknown>,
  options?: { cacheBust?: boolean }
): Promise<StaticLoaderResult> {
  const importPath = options?.cacheBust ? `${loaderPath}?t=${Date.now()}` : loaderPath;
  const mod = await import(importPath);
  const handler = mod.default ?? mod.getStaticPaths ?? mod.loader;

  if (typeof handler !== "function") {
    return { props: {} };
  }

  const result = await handler({
    data: globalData,
    env: (globalData.env as Record<string, string>) || {},
  });

  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if ("props" in record || "seo" in record || "feed" in record) {
      return {
        props: (record.props as Record<string, unknown>) || {},
        seo: record.seo as PageSeo | undefined,
        feed: record.feed as FeedItem | undefined,
      };
    }
    return { props: record };
  }

  return { props: {} };
}

/**
 * Creates a declarative pagination helper for a given base route URL.
 * Automatically handles page 1 omission for canonical clean URLs.
 */
export function createPaginator(baseRouteUrl: string) {
  const normalizedBase = baseRouteUrl === "/" ? "" : baseRouteUrl.replace(/\/+$/, "");

  return function paginate<T = unknown>(
    items: T[],
    options?: PaginateOptions
  ): StaticPathResult[] {
    const pageSize = Math.max(1, options?.pageSize || 10);
    const total = items.length;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const results: StaticPathResult[] = [];

    for (let p = 1; p <= lastPage; p++) {
      const start = (p - 1) * pageSize;
      const end = start + pageSize;
      const pageData = items.slice(start, end);

      const currentUrl = p === 1 ? (normalizedBase || "/") : `${normalizedBase}/${p}`;
      const prevUrl = p === 1 ? null : (p === 2 ? (normalizedBase || "/") : `${normalizedBase}/${p - 1}`);
      const nextUrl = p < lastPage ? `${normalizedBase}/${p + 1}` : null;

      const pageInfo: PaginatePage<T> = {
        data: pageData,
        start,
        end: Math.min(end, total),
        total,
        currentPage: p,
        size: pageSize,
        lastPage,
        url: {
          current: currentUrl,
          prev: prevUrl,
          next: nextUrl,
        },
      };

      results.push({
        params: { page: String(p) },
        props: {
          ...(options?.props || {}),
          page: pageInfo,
        },
      });
    }

    return results;
  };
}

/**
 * Validates route parameters: ensures they exist, are non-empty, and URL-safe.
 */
export function validateRouteParams(
  requiredTokens: string[],
  params: Record<string, unknown>,
  loaderPath: string
): Record<string, string> {
  const cleanParams: Record<string, string> = {};

  for (const token of requiredTokens) {
    const rawVal = params[token];

    if (rawVal === undefined || rawVal === null) {
      throw new Error(
        `[Bustatic Error]: Missing required route parameter "${token}" in loader "${loaderPath}".\n` +
          `  Provided parameters: ${JSON.stringify(params)}`
      );
    }

    const strVal = String(rawVal).trim();
    if (strVal === "") {
      throw new Error(
        `[Bustatic Error]: Route parameter "${token}" in loader "${loaderPath}" cannot be an empty string.`
      );
    }

    if (/[\/\\?#\0]/.test(strVal)) {
      throw new Error(
        `[Bustatic Error]: Route parameter "${token}" with value "${strVal}" in "${loaderPath}" contains invalid characters (/ \\ ? #).`
      );
    }

    cleanParams[token] = strVal;
  }

  return cleanParams;
}

/**
 * Builds a clean URL path and relative output file path from a template pattern and parameters.
 */
export function buildCleanUrl(
  patternRelPath: string,
  params: Record<string, string>
): { urlPath: string; relOutputPath: string } {
  const isDynamic = isDynamicPattern(patternRelPath);

  let pathStr = patternRelPath.split(sep).join("/");
  pathStr = pathStr.replace(/\.html$/, "");

  const isPageParam = pathStr.endsWith("/[page]") || pathStr === "[page]";
  const isFirstPage = String(params.page) === "1";

  if (isPageParam && isFirstPage) {
    if (pathStr === "[page]") {
      pathStr = "";
    } else {
      pathStr = pathStr.replace(/\/\[page\]$/, "");
    }
  } else {
    for (const [key, val] of Object.entries(params)) {
      pathStr = pathStr.replaceAll(`[${key}]`, val);
    }
  }

  if (pathStr === "" || pathStr === "index") {
    return {
      urlPath: "/",
      relOutputPath: "index.html",
    };
  }

  let cleanUrl = pathStr;
  if (cleanUrl.endsWith("/index")) {
    cleanUrl = cleanUrl.slice(0, -6);
  }
  cleanUrl = "/" + cleanUrl.replace(/^\/+|\/+$/g, "");

  let relOutputPath: string;
  if (isDynamic || isPageParam || patternRelPath.endsWith("index.html")) {
    relOutputPath = pathStr.replace(/^\/+/, "") + "/index.html";
  } else {
    relOutputPath = patternRelPath.split(sep).join("/");
  }

  return {
    urlPath: cleanUrl,
    relOutputPath,
  };
}

function registerRouteOrThrow(
  urlRegistry: Map<string, string>,
  urlPath: string,
  sourceDesc: string
): void {
  if (urlRegistry.has(urlPath)) {
    throw new Error(
      `[Bustatic Collision Error]: Duplicate route generated for "${urlPath}".\n` +
        `  - First generated by: ${urlRegistry.get(urlPath)}\n` +
        `  - Conflicting with:   ${sourceDesc}`
    );
  }
  urlRegistry.set(urlPath, sourceDesc);
}

async function resolveStaticRoute(options: {
  config: ResolvedConfig;
  templatePath: string;
  relPattern: string;
  loaderPath: string | null;
  globalData: Record<string, unknown>;
  cacheBust?: boolean;
  urlRegistry: Map<string, string>;
}): Promise<PageRouteInfo> {
  const { config, templatePath, relPattern, loaderPath, globalData, cacheBust, urlRegistry } = options;

  let loaderResult: StaticLoaderResult = { props: {} };
  if (loaderPath) {
    try {
      loaderResult = await executeStaticLoader(loaderPath, globalData, { cacheBust });
    } catch (err: unknown) {
      logError(`Error executing loader "${relative(config.root, loaderPath)}"`, err);
      throw err;
    }
  }

  const { urlPath, relOutputPath } = buildCleanUrl(relPattern, {});
  registerRouteOrThrow(urlRegistry, urlPath, relPattern);

  return {
    patternRelativePath: relPattern,
    templateFilePath: templatePath,
    urlPath,
    outputFilePath: join(config.outDir, relOutputPath),
    params: {},
    props: loaderResult.props,
    isDynamic: false,
    seo: loaderResult.seo,
    feed: loaderResult.feed,
  };
}

async function resolveDynamicRoutes(options: {
  config: ResolvedConfig;
  templatePath: string;
  relPattern: string;
  tokens: string[];
  loaderPath: string | null;
  globalData: Record<string, unknown>;
  cacheBust?: boolean;
  urlRegistry: Map<string, string>;
}): Promise<PageRouteInfo[]> {
  const {
    config,
    templatePath,
    relPattern,
    tokens,
    loaderPath,
    globalData,
    cacheBust,
    urlRegistry,
  } = options;

  if (!loaderPath) {
    const expected = relPattern.replace(/\.html$/, ".data.ts");
    throw new Error(
      `[Bustatic Error]: Dynamic page "${relPattern}" contains parameter(s) [${tokens.join(", ")}], but no co-located loader was found.\n` +
        `👉 Create "${expected}" exporting a default async function or getStaticPaths().`
    );
  }

  const relLoader = relative(config.root, loaderPath);
  let mod: Record<string, unknown>;
  try {
    const importPath = cacheBust ? `${loaderPath}?t=${Date.now()}` : loaderPath;
    mod = (await import(importPath)) as Record<string, unknown>;
  } catch (err: unknown) {
    logError(`Failed to import loader "${relLoader}"`, err);
    throw err;
  }

  const handler = mod.default ?? mod.getStaticPaths;
  if (typeof handler !== "function") {
    throw new Error(
      `[Bustatic Error]: Loader "${relLoader}" must export a default function ("export default async function") or "getStaticPaths".`
    );
  }

  const basePattern = relPattern.split(sep).join("/").replace(/\.html$/, "");
  const lastSlash = basePattern.lastIndexOf("/");
  const baseRouteUrl = lastSlash === -1 ? "/" : "/" + basePattern.slice(0, lastSlash);

  let pathsResult: unknown;
  try {
    pathsResult = await handler({
      data: globalData,
      env: (globalData.env as Record<string, string>) || {},
      paginate: createPaginator(baseRouteUrl),
    });
  } catch (err: unknown) {
    logError(`Error executing dynamic loader "${relLoader}"`, err);
    throw err;
  }

  if (!Array.isArray(pathsResult)) {
    throw new Error(
      `[Bustatic Error]: Dynamic loader "${relLoader}" must return an Array of path objects ({ params, props }). Received: ${typeof pathsResult}.`
    );
  }

  if (pathsResult.length === 0) {
    logWarn(`Dynamic loader "${relLoader}" returned 0 paths. No pages generated for "${relPattern}".`);
    return [];
  }

  const resolved: PageRouteInfo[] = [];
  for (let i = 0; i < pathsResult.length; i++) {
    const item = pathsResult[i] as StaticPathResult | undefined;
    if (!item || typeof item !== "object" || !item.params || typeof item.params !== "object") {
      throw new Error(
        `[Bustatic Error]: Item at index ${i} in loader "${relLoader}" must be an object with a "params" property.\n` +
          `  Received: ${JSON.stringify(item)}`
      );
    }

    const cleanParams = validateRouteParams(tokens, item.params, relLoader);
    const { urlPath, relOutputPath } = buildCleanUrl(relPattern, cleanParams);
    const sourceDesc = `${relLoader} (params: ${JSON.stringify(cleanParams)})`;

    registerRouteOrThrow(urlRegistry, urlPath, sourceDesc);

    resolved.push({
      patternRelativePath: relPattern,
      templateFilePath: templatePath,
      urlPath,
      outputFilePath: join(config.outDir, relOutputPath),
      params: cleanParams,
      props: item.props || {},
      isDynamic: true,
      seo: item.seo,
      feed: item.feed,
    });
  }

  return resolved;
}

/**
 * Resolves all routes (static and dynamic) in a Bustatic project.
 * Enforces co-located loaders, executes them, validates parameters, and prevents URL collisions.
 */
export async function resolveAllRoutes(
  config: ResolvedConfig,
  globalData: Record<string, unknown>,
  options?: { cacheBust?: boolean }
): Promise<PageRouteInfo[]> {
  const htmlFiles = walkFiles(config.pagesDir, {
    ignoreDotfiles: true,
    filter: (_abs, entry) => entry.endsWith(".html"),
  });
  const routes: PageRouteInfo[] = [];
  const urlRegistry = new Map<string, string>();

  for (const templatePath of htmlFiles) {
    const relPattern = relative(config.pagesDir, templatePath);
    const isDynamic = isDynamicPattern(relPattern);
    const tokens = extractRouteTokens(relPattern);
    const loaderPath = findCoLocatedLoader(templatePath);

    if (!isDynamic) {
      routes.push(
        await resolveStaticRoute({
          config,
          templatePath,
          relPattern,
          loaderPath,
          globalData,
          cacheBust: options?.cacheBust,
          urlRegistry,
        })
      );
    } else {
      routes.push(
        ...(await resolveDynamicRoutes({
          config,
          templatePath,
          relPattern,
          tokens,
          loaderPath,
          globalData,
          cacheBust: options?.cacheBust,
          urlRegistry,
        }))
      );
    }
  }

  return routes;
}
