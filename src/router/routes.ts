import { join, relative, dirname, extname, sep } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { ResolvedConfig, PageRouteInfo, StaticPathResult, PaginateOptions, PaginatePage } from "../types.ts";

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
 * Creates a declarative pagination helper for a given base route URL.
 * Automatically handles page 1 omission for canonical clean URLs.
 */
export function createPaginator(baseRouteUrl: string) {
  const normalizedBase = baseRouteUrl === "/" ? "" : baseRouteUrl.replace(/\/+$/, "");

  return function paginate<T = any>(
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
  params: Record<string, any>,
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

    // Reject characters that break URL paths or directory navigation
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
 * e.g. "blog/[slug].html" with { slug: "post" } -> urlPath: "/blog/post", relOutput: "blog/post/index.html"
 * e.g. "catalogo/[page].html" with { page: "1" } -> urlPath: "/catalogo", relOutput: "catalogo/index.html"
 * e.g. "about.html" -> urlPath: "/about", relOutput: "about.html"
 */
export function buildCleanUrl(
  patternRelPath: string,
  params: Record<string, string>
): { urlPath: string; relOutputPath: string } {
  const isDynamic = isDynamicPattern(patternRelPath);

  // Normalize path separators to forward slash
  let pathStr = patternRelPath.split(sep).join("/");
  pathStr = pathStr.replace(/\.html$/, "");

  // Check if the last segment is [page] and its value is "1"
  const isPageParam = pathStr.endsWith("/[page]") || pathStr === "[page]";
  const isFirstPage = params.page === "1" || params.page === 1;

  if (isPageParam && isFirstPage) {
    if (pathStr === "[page]") {
      pathStr = "";
    } else {
      pathStr = pathStr.replace(/\/\[page\]$/, "");
    }
  } else {
    // Substitute all [param] tokens
    for (const [key, val] of Object.entries(params)) {
      pathStr = pathStr.replaceAll(`[${key}]`, val);
    }
  }

  // Root index page
  if (pathStr === "" || pathStr === "index") {
    return {
      urlPath: "/",
      relOutputPath: "index.html",
    };
  }

  // Remove trailing /index if present
  let cleanUrl = pathStr;
  if (cleanUrl.endsWith("/index")) {
    cleanUrl = cleanUrl.slice(0, -6);
  }
  cleanUrl = "/" + cleanUrl.replace(/^\/+|\/+$/g, "");

  // Output path: dynamic routes and pagination always use clean folder/index.html
  // Static pages preserve their folder structure (e.g. about.html or docs/install.html)
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

/**
 * Scans a directory recursively for .html files.
 */
function findHtmlFiles(dir: string, baseDir = dir): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      results.push(...findHtmlFiles(full, baseDir));
    } else if (entry.endsWith(".html")) {
      results.push(full);
    }
  }

  return results;
}

/**
 * Resolves all routes (static and dynamic) in a Bustatic project.
 * Enforces co-located loaders, executes them, validates parameters, and prevents URL collisions.
 */
export async function resolveAllRoutes(
  config: ResolvedConfig,
  globalData: Record<string, any>
): Promise<PageRouteInfo[]> {
  const htmlFiles = findHtmlFiles(config.pagesDir);
  const routes: PageRouteInfo[] = [];
  const urlRegistry = new Map<string, string>(); // urlPath -> source identifier for collision detection

  for (const templatePath of htmlFiles) {
    const relPattern = relative(config.pagesDir, templatePath);
    const isDynamic = isDynamicPattern(relPattern);
    const tokens = extractRouteTokens(relPattern);
    const loaderPath = findCoLocatedLoader(templatePath);

    if (!isDynamic) {
      // 1. Static page
      let props: Record<string, any> = {};
      let seo: any = undefined;
      let feed: any = undefined;

      if (loaderPath) {
        try {
          const mod = await import(loaderPath);
          const handler = mod.default ?? mod.getStaticPaths ?? mod.loader;
          if (typeof handler === "function") {
            const result = await handler({
              data: globalData,
              env: globalData.env || {},
            });
            if (result && typeof result === "object" && !Array.isArray(result)) {
              if ("props" in result || "seo" in result || "feed" in result) {
                props = result.props || {};
                seo = result.seo;
                feed = result.feed;
              } else {
                props = result;
              }
            }
          }
        } catch (err: any) {
          console.error(
            `\x1b[31m[Bustatic Error]\x1b[0m Error executing loader "${relative(config.root, loaderPath)}":`,
            err?.message || err
          );
          throw err;
        }
      }

      const { urlPath, relOutputPath } = buildCleanUrl(relPattern, {});

      // Collision check
      if (urlRegistry.has(urlPath)) {
        throw new Error(
          `[Bustatic Collision Error]: Duplicate route generated for "${urlPath}".\n` +
          `  - First generated by: ${urlRegistry.get(urlPath)}\n` +
          `  - Conflicting with:   ${relPattern}`
        );
      }
      urlRegistry.set(urlPath, relPattern);

      routes.push({
        patternRelativePath: relPattern,
        templateFilePath: templatePath,
        urlPath,
        outputFilePath: join(config.outDir, relOutputPath),
        params: {},
        props,
        isDynamic: false,
        seo,
        feed,
      });
    } else {
      // 2. Dynamic page
      if (!loaderPath) {
        const expected = relPattern.replace(/\.html$/, ".data.ts");
        throw new Error(
          `[Bustatic Error]: Dynamic page "${relPattern}" contains parameter(s) [${tokens.join(", ")}], but no co-located loader was found.\n` +
          `👉 Create "${expected}" exporting a default async function or getStaticPaths().`
        );
      }

      const relLoader = relative(config.root, loaderPath);
      let mod: any;
      try {
        mod = await import(loaderPath);
      } catch (err: any) {
        console.error(
          `\x1b[31m[Bustatic Error]\x1b[0m Failed to import loader "${relLoader}":`,
          err?.message || err
        );
        throw err;
      }

      const handler = mod.default ?? mod.getStaticPaths;
      if (typeof handler !== "function") {
        throw new Error(
          `[Bustatic Error]: Loader "${relLoader}" must export a default function ("export default async function") or "getStaticPaths".`
        );
      }

      // Compute base route URL for paginator (e.g. "catalogo/[page].html" -> "/catalogo")
      let basePattern = relPattern.split(sep).join("/").replace(/\.html$/, "");
      const lastSlash = basePattern.lastIndexOf("/");
      const baseRouteUrl = lastSlash === -1 ? "/" : "/" + basePattern.slice(0, lastSlash);

      let pathsResult: any;
      try {
        pathsResult = await handler({
          data: globalData,
          env: globalData.env || {},
          paginate: createPaginator(baseRouteUrl),
        });
      } catch (err: any) {
        console.error(
          `\x1b[31m[Bustatic Error]\x1b[0m Error executing dynamic loader "${relLoader}":`,
          err?.message || err
        );
        throw err;
      }

      if (!Array.isArray(pathsResult)) {
        throw new Error(
          `[Bustatic Error]: Dynamic loader "${relLoader}" must return an Array of path objects ({ params, props }). Received: ${typeof pathsResult}.`
        );
      }

      if (pathsResult.length === 0) {
        console.warn(
          `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Dynamic loader "${relLoader}" returned 0 paths. No pages generated for "${relPattern}".`
        );
        continue;
      }

      for (let i = 0; i < pathsResult.length; i++) {
        const item = pathsResult[i];
        if (!item || typeof item !== "object" || !item.params || typeof item.params !== "object") {
          throw new Error(
            `[Bustatic Error]: Item at index ${i} in loader "${relLoader}" must be an object with a "params" property.\n` +
            `  Received: ${JSON.stringify(item)}`
          );
        }

        const cleanParams = validateRouteParams(tokens, item.params, relLoader);
        const { urlPath, relOutputPath } = buildCleanUrl(relPattern, cleanParams);

        const sourceDesc = `${relLoader} (params: ${JSON.stringify(cleanParams)})`;

        if (urlRegistry.has(urlPath)) {
          throw new Error(
            `[Bustatic Collision Error]: Duplicate route generated for "${urlPath}".\n` +
            `  - First generated by: ${urlRegistry.get(urlPath)}\n` +
            `  - Conflicting with:   ${sourceDesc}`
          );
        }
        urlRegistry.set(urlPath, sourceDesc);

        routes.push({
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
    }
  }

  return routes;
}
