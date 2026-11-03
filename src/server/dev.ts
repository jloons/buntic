import { join, resolve } from "node:path";
import { existsSync, watch } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import type { ResolvedConfig } from "../types.ts";
import { TemplateEngine } from "../template/engine.ts";

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
  const activeSockets = new Set<ServerWebSocket<any>>();

  // Debounced file watcher
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(config.root, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Ignore changes in node_modules, .git, or dist
    if (
      filename.includes("node_modules") ||
      filename.includes(".git") ||
      filename.includes("dist") ||
      filename.includes(".bustatic")
    ) {
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      engine.invalidateDataCache();
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

      // 1. Try matching an HTML page in pagesDir
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

      // 2. Try serving static file from publicDir
      if (existsSync(config.publicDir)) {
        const publicFilePath = join(config.publicDir, pathname);
        if (existsSync(publicFilePath) && !publicFilePath.endsWith("/")) {
          return new Response(Bun.file(publicFilePath));
        }
      }

      // 3. Try serving static asset directly from root (e.g. /styles/main.css, /components/counter.ts)
      const rootAssetPath = join(config.root, pathname);
      if (existsSync(rootAssetPath) && !rootAssetPath.endsWith("/")) {
        return new Response(Bun.file(rootAssetPath));
      }

      // 4. Not found
      return new Response("<h1>404 Not Found</h1>", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  return {
    server,
    port: server.port ?? config.port,
    stop: () => {
      watcher.close();
      server.stop();
    },
  };
}
