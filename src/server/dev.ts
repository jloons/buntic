import { join, resolve } from "node:path";
import { existsSync, watch } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import type { ResolvedConfig } from "../types.ts";
import { TemplateEngine } from "../template/engine.ts";
import { resolveAllRoutes } from "../router/routes.ts";
import { PhotoProcessor } from "../assets/photo-tag.ts";
import { SeoMetadataEngine } from "../seo/metadata.ts";
import { generateSitemapXml } from "../seo/sitemap.ts";
import { generateRobotsTxt } from "../seo/robots.ts";
import { generateRss2Xml, generateAtomXml } from "../seo/feeds.ts";

const LIVE_RELOAD_SCRIPT = `
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

export interface DevServerInstance {
  server: Server<any>;
  port: number;
  stop: () => void;
}

export function startDevServer(config: ResolvedConfig): DevServerInstance {
  const engine = new TemplateEngine(config);
  const photoProcessor = new PhotoProcessor(config);
  const seoEngine = new SeoMetadataEngine(
    config,
    photoProcessor.imageProcessor,
    photoProcessor.storageManager
  );
  const activeSockets = new Set<ServerWebSocket<any>>();

  // Debounced file watcher
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(config.root, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Ignore changes in node_modules, .git, dist, or .bustatic
    if (
      filename.includes("node_modules") ||
      filename.includes(".git") ||
      filename.includes("dist") ||
      filename.includes(".bustatic")
    ) {
      return;
    }

    const changedPath = resolve(config.root, filename);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      engine.invalidateCache(changedPath);
      for (const socket of activeSockets) {
        socket.send("reload");
      }
    }, 60);
  });

  const server = Bun.serve({
    port: config.port,
    websocket: {
      message(_ws, _msg) {},
      open(ws) {
        activeSockets.add(ws);
      },
      close(ws) {
        activeSockets.delete(ws);
      },
    },
    async fetch(req, srv) {
      const url = new URL(req.url);
      const pathname = decodeURIComponent(url.pathname);

      // WebSocket live reload endpoint
      if (pathname === "/_bustatic/ws") {
        if (srv.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Serve processed images from photoProcessor / seoEngine in memory
      if (photoProcessor.emittedAssets.has(pathname)) {
        const asset = photoProcessor.emittedAssets.get(pathname)!;
        return new Response(asset.bytes, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      if (seoEngine.emittedAssets.has(pathname)) {
        const asset = seoEngine.emittedAssets.get(pathname)!;
        return new Response(asset.bytes, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      // Serve dynamic SEO files in dev mode
      if (pathname === "/sitemap.xml") {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData);
        const sitemap = generateSitemapXml(routes, config);
        if (sitemap) {
          return new Response(sitemap, {
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      if (pathname === "/robots.txt") {
        const robots = generateRobotsTxt(config);
        if (robots) {
          return new Response(robots, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }

      if (pathname === "/rss.xml") {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData);
        const rss = generateRss2Xml(routes, config);
        if (rss) {
          return new Response(rss, {
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      if (pathname === "/atom.xml") {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData);
        const atom = generateAtomXml(routes, config);
        if (atom) {
          return new Response(atom, {
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      // 1. Try matching an exact static HTML page in pagesDir
      const candidatePagePaths: string[] = [];
      if (pathname === "/" || pathname === "") {
        candidatePagePaths.push(join(config.pagesDir, "index.html"));
      } else {
        const clean = pathname.replace(/^\/+|\/+$/g, "");
        candidatePagePaths.push(join(config.pagesDir, `${clean}.html`));
        candidatePagePaths.push(join(config.pagesDir, clean, "index.html"));
      }

      for (const cand of candidatePagePaths) {
        if (existsSync(cand)) {
          try {
            const raw = await Bun.file(cand).text();
            let rendered = await engine.renderPage(raw, cand);

            // Process <photo> tags
            rendered = await photoProcessor.processHtml(rendered, cand);

            // Process SEO
            rendered = await seoEngine.processSeo(rendered, {
              templatePath: cand,
              urlPath: pathname === "" ? "/" : pathname,
            });

            // Inject live-reload script
            if (rendered.includes("</body>")) {
              rendered = rendered.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`);
            } else {
              rendered += LIVE_RELOAD_SCRIPT;
            }

            return new Response(rendered, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (err: any) {
            return new Response(
              `<h1>[Bustatic Template Error]</h1><pre>${err?.message || err}</pre>`,
              {
                status: 500,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }
            );
          }
        }
      }

      // 2. Try matching dynamic routes ([slug], [page], etc.)
      try {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData);
        const cleanRequested =
          pathname === "" || pathname === "/" ? "/" : "/" + pathname.replace(/^\/+|\/+$/g, "");
        const matchedRoute = routes.find((r) => r.urlPath === cleanRequested);

        if (matchedRoute) {
          const raw = await Bun.file(matchedRoute.templateFilePath).text();
          let rendered = await engine.renderPage(raw, matchedRoute.templateFilePath, {
            params: matchedRoute.params,
            props: matchedRoute.props,
          });

          // Process <photo> tags
          rendered = await photoProcessor.processHtml(rendered, matchedRoute.templateFilePath);

          // Process SEO
          rendered = await seoEngine.processSeo(rendered, {
            templatePath: matchedRoute.templateFilePath,
            urlPath: matchedRoute.urlPath,
            routeSeo: matchedRoute.seo,
          });

          if (rendered.includes("</body>")) {
            rendered = rendered.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`);
          } else {
            rendered += LIVE_RELOAD_SCRIPT;
          }

          return new Response(rendered, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      } catch (err: any) {
        return new Response(
          `<h1>[Bustatic Dynamic Route Error]</h1><pre>${err?.message || err}</pre>`,
          {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        );
      }

      // 3. Try serving generated page-specific scoped CSS (in external mode)
      if (engine.generatedPageStyles.has(pathname)) {
        const css = engine.generatedPageStyles.get(pathname)!;
        return new Response(css, {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      }

      // 4. Try serving static file from publicDir
      if (existsSync(config.publicDir)) {
        const publicFilePath = join(config.publicDir, pathname);
        if (existsSync(publicFilePath) && !publicFilePath.endsWith("/")) {
          return serveFileWithTranspiler(publicFilePath);
        }
      }

      // 5. Try serving static asset directly from root or src/ (e.g. /styles/main.css, /components/counter.ts)
      const rootAssetPath = join(config.root, pathname);
      if (existsSync(rootAssetPath) && !rootAssetPath.endsWith("/")) {
        return serveFileWithTranspiler(rootAssetPath);
      }

      const srcAssetPath = join(config.root, "src", pathname);
      if (existsSync(srcAssetPath) && !srcAssetPath.endsWith("/")) {
        return serveFileWithTranspiler(srcAssetPath);
      }

      // 6. Assisted 404 in Dev Mode with list of available routes
      let availableRoutesHtml = "";
      try {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData);
        if (routes.length > 0) {
          availableRoutesHtml = `
            <h3>Rutas disponibles en este proyecto (${routes.length}):</h3>
            <ul>
              ${routes
                .map(
                  (r) =>
                    `<li><a href="${r.urlPath}"><code>${r.urlPath}</code></a> <span style="color:#94a3b8">(${r.patternRelativePath})</span></li>`
                )
                .join("")}
            </ul>
          `;
        }
      } catch {
        // Ignore errors when listing routes for 404
      }

      const notFoundHtml = `
        <!doctype html>
        <html>
        <head>
          <title>404 - No Encontrado | Bustatic Dev</title>
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
            <h1>404 - Página no encontrada</h1>
            <p>La ruta solicitada <code>${pathname}</code> no coincide con ninguna página o archivo estático.</p>
            ${availableRoutesHtml}
          </div>
        </body>
        </html>
      `;

      return new Response(notFoundHtml, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  return {
    server,
    port: config.port,
    stop: () => {
      watcher.close();
      server.stop();
    },
  };
}

async function serveFileWithTranspiler(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);

  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    const transpiler = new Bun.Transpiler({ loader: filePath.endsWith(".tsx") ? "tsx" : "ts" });
    const code = await file.text();
    const transpiled = transpiler.transformSync(code);
    return new Response(transpiled, {
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  const contentType = getMimeType(filePath);
  return new Response(file, {
    headers: { "Content-Type": contentType },
  });
}

function getMimeType(path: string): string {
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
