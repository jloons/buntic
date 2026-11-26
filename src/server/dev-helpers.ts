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
import { BunticTemplateError } from "../template/errors.ts";
import { escapeHtml, injectBeforeBodyEnd } from "../utils/html.ts";
import { getErrorMessage } from "../utils/logger.ts";
import { isPathInside } from "../utils/paths.ts";

export const LIVE_RELOAD_SCRIPT = `
<script id="__buntic_live_reload">
  (() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(\`\${protocol}//\${location.host}/_buntic/ws\`);
    ws.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('[buntic] Change detected. Reloading...');
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

function formatCodeFrameHtml(codeFrame: string): string {
  return codeFrame
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith("  > ")) {
        return `<span class="error-line">${escaped}</span>`;
      }
      if (/^\s+\|\s+\^+$/.test(line)) {
        return `<span class="error-caret">${escaped}</span>`;
      }
      return escaped;
    })
    .join("\n");
}

export function renderErrorResponse(title: string, err: unknown): Response {
  const safeTitle = escapeHtml(title);
  const safeMsg = escapeHtml(getErrorMessage(err));

  let bodyContent: string;
  if (err instanceof BunticTemplateError) {
    const metaRows: string[] = [];
    if (err.filePath) {
      const coords = err.line
        ? `:${err.line}${err.column ? `:${err.column}` : ""}`
        : "";
      metaRows.push(
        `<div class="meta-row"><span class="meta-label">File</span><code>${escapeHtml(err.filePath + coords)}</code></div>`
      );
    } else if (err.line) {
      const colText = err.column ? `, column ${err.column}` : "";
      metaRows.push(
        `<div class="meta-row"><span class="meta-label">Location</span><code>line ${err.line}${colText}</code></div>`
      );
    }
    if (err.resolvedTarget) {
      metaRows.push(
        `<div class="meta-row"><span class="meta-label">Resolved</span><code>${escapeHtml(err.resolvedTarget)}</code></div>`
      );
    }
    if (err.causeMessage) {
      metaRows.push(
        `<div class="meta-row"><span class="meta-label">Cause</span><span class="cause-text">${escapeHtml(err.causeMessage)}</span></div>`
      );
    }

    const metaBlock = metaRows.length > 0 ? `<div class="meta">${metaRows.join("")}</div>` : "";
    const frameBlock = err.codeFrame
      ? `<pre class="code-frame">${formatCodeFrameHtml(err.codeFrame)}</pre>`
      : "";
    const hintBlock = err.hint
      ? `<div class="hint"><strong>Hint:</strong> ${escapeHtml(err.hint).replace(/\n/g, "<br>")}</div>`
      : "";

    bodyContent = `
      <p class="summary">${escapeHtml(err.summary)}</p>
      ${metaBlock}
      ${frameBlock}
      ${hintBlock}
    `;
  } else {
    bodyContent = `<pre class="code-frame">${safeMsg}</pre>`;
  }

  const errorHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle} | Buntic Dev</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 2.5rem 1.5rem; margin: 0; }
    .card { max-width: 820px; margin: 0 auto; background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #334155; box-shadow: 0 20px 40px rgba(0,0,0,0.35); }
    h1 { color: #f43f5e; margin: 0 0 1rem; font-size: 1.5rem; }
    .summary { font-size: 1.05rem; color: #fecdd3; margin: 0 0 1.25rem; line-height: 1.5; font-weight: 500; }
    .meta { display: flex; flex-direction: column; gap: 0.45rem; margin-bottom: 1.25rem; padding: 0.9rem 1rem; background: #0f172a; border-radius: 8px; border: 1px solid #334155; }
    .meta-row { display: flex; align-items: baseline; gap: 0.75rem; font-size: 0.92rem; flex-wrap: wrap; }
    .meta-label { color: #94a3b8; min-width: 72px; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.04em; }
    code { color: #38bdf8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; word-break: break-all; }
    .cause-text { color: #fda4af; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; }
    pre.code-frame { background: #020617; color: #e2e8f0; padding: 1rem 1.1rem; border-radius: 8px; border: 1px solid #334155; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; line-height: 1.6; margin: 0 0 1.25rem; }
    .error-line { display: inline-block; min-width: 100%; background: rgba(244, 63, 94, 0.18); color: #fff1f2; font-weight: 600; }
    .error-caret { color: #f43f5e; font-weight: 700; }
    .hint { background: rgba(56, 189, 248, 0.1); border-left: 3px solid #38bdf8; padding: 0.85rem 1rem; border-radius: 0 8px 8px 0; color: #e0f2fe; font-size: 0.92rem; line-height: 1.55; }
    .hint strong { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    ${bodyContent}
  </div>
  ${LIVE_RELOAD_SCRIPT}
</body>
</html>`;

  return new Response(errorHtml, {
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
      <title>404 - Not Found | Buntic Dev</title>
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
