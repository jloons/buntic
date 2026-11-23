import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PageRouteInfo, PageSeo, ResolvedConfig } from "../types.ts";
import type { PhotoProcessor } from "../assets/photo-tag.ts";
import { resolveAllRoutes } from "../router/routes.ts";
import { generateAtomXml, generateRss2Xml } from "../seo/feeds.ts";
import type { SeoMetadataEngine } from "../seo/metadata.ts";
import { generateRobotsTxt } from "../seo/robots.ts";
import { generateSitemapXml } from "../seo/sitemap.ts";
import type { TemplateEngine } from "../template/engine.ts";
import { escapeHtml, injectBeforeBodyEnd } from "../utils/html.ts";
import { getErrorMessage } from "../utils/logger.ts";
import { isPathInside } from "../utils/paths.ts";

export const LIVE_RELOAD_SCRIPT = `
<script id="__bustatic_live_reload">
  (() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(\`\${protocol}//\${location.host}/_bustatic/ws\`);
    ws.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('[bustatic] Change detected. Reloading...');
        location.reload();
      }
    };
    ws.onclose = () => {
      setTimeout(() => location.reload(), 1500);
    };
  })();
</script>
`;

/**
 * Renders an HTML page through TemplateEngine, PhotoProcessor, SeoMetadataEngine,
 * and appends the dev live-reload WebSocket snippet.
 */
export async function renderDevPage(options: {
  templatePath: string;
  urlPath: string;
  params?: Record<string, string>;
  props?: Record<string, unknown>;
  routeSeo?: PageSeo;
  engine: TemplateEngine;
  photoProcessor: PhotoProcessor;
  seoEngine: SeoMetadataEngine;
}): Promise<Response> {
  const {
    templatePath,
    urlPath,
    params,
    props = {},
    routeSeo,
    engine,
    photoProcessor,
    seoEngine,
  } = options;

  const raw = await Bun.file(templatePath).text();
  let rendered = await engine.renderPage(raw, templatePath, { params, props });
  rendered = await photoProcessor.processHtml(rendered, templatePath);
  rendered = await seoEngine.processSeo(rendered, {
    templatePath,
    urlPath,
    routeSeo,
  });
  rendered = injectBeforeBodyEnd(rendered, LIVE_RELOAD_SCRIPT);

  return new Response(rendered, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export async function tryServeSeoRoute(
  pathname: string,
  config: ResolvedConfig,
  engine: TemplateEngine
): Promise<Response | null> {
  if (pathname === "/robots.txt") {
    const robots = generateRobotsTxt(config);
    if (robots) {
      return new Response(robots, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return null;
  }

  if (pathname === "/sitemap.xml" || pathname === "/rss.xml" || pathname === "/atom.xml") {
    const globalData = await engine.loadData();
    const routes = await resolveAllRoutes(config, globalData);

    let xml: string | null = null;
    if (pathname === "/sitemap.xml") {
      xml = generateSitemapXml(routes, config);
    } else if (pathname === "/rss.xml") {
      xml = generateRss2Xml(routes, config);
    } else {
      xml = generateAtomXml(routes, config);
    }

    if (xml) {
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }
  }

  return null;
}

/**
 * Safely resolves a request pathname inside a base directory, returning the file path
 * only if it stays strictly inside `baseDir` and points to an existing regular file.
 */
export function resolveSafeStaticFile(baseDir: string, pathname: string): string | null {
  if (!existsSync(baseDir)) return null;
  const relPath = pathname.replace(/^\/+/, "");
  if (!relPath) return null;

  const candidate = join(baseDir, relPath);
  if (!isPathInside(baseDir, candidate)) {
    return null;
  }

  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  } catch {
    // Ignore stat errors
  }

  return null;
}

export async function serveFileWithTranspiler(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);

  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    const transpiler = new Bun.Transpiler({ loader: filePath.endsWith(".tsx") ? "tsx" : "ts" });
    const code = await file.text();
    const transpiled = transpiler.transformSync(code);
    return new Response(transpiled, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  return new Response(file, {
    headers: {
      "Content-Type": getMimeType(filePath),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export function getMimeType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function renderErrorResponse(title: string, err: unknown): Response {
  const safeTitle = escapeHtml(title);
  const safeMsg = escapeHtml(getErrorMessage(err));
  return new Response(`<h1>${safeTitle}</h1><pre>${safeMsg}</pre>`, {
    status: 500,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function renderNotFoundResponse(pathname: string, routes: PageRouteInfo[]): Response {
  const safePathname = escapeHtml(pathname);
  const availableRoutesHtml =
    routes.length > 0
      ? `
        <h3>Available routes in this project (${routes.length}):</h3>
        <ul>
          ${routes
            .map(
              (r) =>
                `<li><a href="${escapeHtml(r.urlPath)}"><code>${escapeHtml(r.urlPath)}</code></a> <span style="color:#94a3b8">(${escapeHtml(r.patternRelativePath)})</span></li>`
            )
            .join("")}
        </ul>
      `
      : "";

  const notFoundHtml = `
    <!doctype html>
    <html>
    <head>
      <title>404 - Not Found | Bustatic Dev</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 3rem; }
        .card { max-width: 650px; margin: 0 auto; background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; }
        h1 { color: #f43f5e; margin-top: 0; }
        code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; color: #38bdf8; font-family: monospace; }
        ul { line-height: 1.8; }
        a { color: #38bdf8; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>404 - Page Not Found</h1>
        <p>The requested route <code>${safePathname}</code> does not match any page or static file.</p>
        ${availableRoutesHtml}
      </div>
    </body>
    </html>
  `;

  return new Response(notFoundHtml, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
