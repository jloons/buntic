import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import type { PageRouteInfo, ResolvedConfig } from "../types.ts";
import { PhotoProcessor } from "../assets/photo-tag.ts";
import { detectPublicCollisions } from "../builder/collisions.ts";
import { executeStaticLoader, findCoLocatedLoader, resolveAllRoutes } from "../router/routes.ts";
import { SeoMetadataEngine } from "../seo/metadata.ts";
import { TemplateEngine } from "../template/engine.ts";
import { isIgnoredPath } from "../template/vfs.ts";
import { logWarn } from "../utils/logger.ts";
import {
  renderDevPage,
  renderErrorResponse,
  renderNotFoundResponse,
  resolveSafeStaticFile,
  serveFileWithTranspiler,
  tryServeSeoRoute,
} from "./dev-helpers.ts";

export interface DevServerInstance {
  server: Server<undefined>;
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
  const activeSockets = new Set<ServerWebSocket<undefined>>();

  // Proactively warn about any public/ file collisions on dev server startup
  (async () => {
    try {
      const globalData = await engine.loadData();
      const routes = await resolveAllRoutes(config, globalData);
      const collisions = detectPublicCollisions(config, routes);
      for (const c of collisions) {
        if (c.type === "route") {
          logWarn(
            `Public file "${c.publicPath}" conflicts with page template "${c.conflictWith}" (both resolve to "${c.outputPath}").`,
            "Buntic Collision Warning"
          );
        } else {
          logWarn(
            `Public file "${c.publicPath}" conflicts with reserved internal path "${c.conflictWith}".`,
            "Buntic Collision Warning"
          );
        }
      }
    } catch {
      // Ignore initial scanning errors in dev server
    }
  })();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChangedPaths = new Set<string>();

  const watcher = watch(config.root, { recursive: true }, (_eventType, filename) => {
    if (!filename || isIgnoredPath(filename)) return;

    const changedPath = resolve(config.root, filename);
    pendingChangedPaths.add(changedPath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const p of pendingChangedPaths) {
        engine.invalidateCache(p);
      }
      pendingChangedPaths.clear();
      engine.vfs.clearContentCache();
      photoProcessor.storageManager.invalidate();
      photoProcessor.emittedAssets.clear();
      seoEngine.emittedAssets.clear();

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
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      if (pathname === "/_buntic/ws") {
        if (srv.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Serve processed images from photoProcessor / seoEngine in memory
      const emittedAsset =
        photoProcessor.emittedAssets.get(pathname) || seoEngine.emittedAssets.get(pathname);
      if (emittedAsset) {
        return new Response(new Uint8Array(emittedAsset.bytes), {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      // Serve dynamic SEO files in dev mode
      const seoResponse = await tryServeSeoRoute(pathname, config, engine);
      if (seoResponse) return seoResponse;

      // 1. Try matching an exact static HTML page in pagesDir
      const clean = pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
      const candidateRelPaths =
        clean === "" || clean === "index"
          ? ["index.html"]
          : [`${clean}.html`, join(clean, "index.html")];

      for (const relCand of candidateRelPaths) {
        const cand = resolveSafeStaticFile(config.pagesDir, relCand);
        if (!cand) continue;

        try {
          const loaderPath = findCoLocatedLoader(cand);
          let props: Record<string, unknown> = {};
          let routeSeo = undefined;

          if (loaderPath) {
            const globalData = await engine.loadData();
            const loaderResult = await executeStaticLoader(loaderPath, globalData, {
              cacheBust: true,
            });
            props = loaderResult.props;
            routeSeo = loaderResult.seo;
          }

          const normalizedUrlPath = clean === "" || clean === "index" ? "/" : `/${clean}`;
          return await renderDevPage({
            templatePath: cand,
            urlPath: normalizedUrlPath,
            props,
            routeSeo,
            engine,
            photoProcessor,
            seoEngine,
          });
        } catch (err: unknown) {
          return renderErrorResponse("[Buntic Template Error]", err);
        }
      }

      // 2. Try matching dynamic routes ([slug], [page], etc.)
      try {
        const globalData = await engine.loadData();
        const routes = await resolveAllRoutes(config, globalData, { cacheBust: true });
        const cleanRequested =
          pathname === "" || pathname === "/" ? "/" : "/" + pathname.replace(/^\/+|\/+$/g, "");
        const matchedRoute = routes.find((r) => r.urlPath === cleanRequested);

        if (matchedRoute) {
          return await renderDevPage({
            templatePath: matchedRoute.templateFilePath,
            urlPath: matchedRoute.urlPath,
            params: matchedRoute.params,
            props: matchedRoute.props,
            routeSeo: matchedRoute.seo,
            engine,
            photoProcessor,
            seoEngine,
          });
        }
      } catch (err: unknown) {
        return renderErrorResponse("[Buntic Dynamic Route Error]", err);
      }

      // 3. Try serving generated page-specific scoped CSS (in external mode)
      if (engine.generatedPageStyles.has(pathname)) {
        const css = engine.generatedPageStyles.get(pathname)!;
        return new Response(css, {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      // 4. Try serving static files safely from publicDir, root, or src/
      const staticCandidates = [
        resolveSafeStaticFile(config.publicDir, pathname),
        resolveSafeStaticFile(config.root, pathname),
        resolveSafeStaticFile(join(config.root, "src"), pathname),
      ];
      for (const staticFile of staticCandidates) {
        if (staticFile && existsSync(staticFile)) {
          return serveFileWithTranspiler(staticFile);
        }
      }

      // 5. Assisted 404 in Dev Mode with list of available routes
      let routes: PageRouteInfo[] = [];
      try {
        const globalData = await engine.loadData();
        routes = await resolveAllRoutes(config, globalData);
      } catch {
        // Ignore errors when listing routes for 404
      }

      return renderNotFoundResponse(pathname, routes);
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
