import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { loadPublicEnv, isReservedNamespace } from "../env.ts";
import { logError, logWarn } from "../utils/logger.ts";
import type { VirtualFileSystem } from "./vfs.ts";

export type TemplateContext = Record<string, any>;

/**
 * Loads all JSON and TS/JS data files in `config.dataDir` into an in-memory map,
 * along with public environment variables under the reserved `"env"` namespace.
 */
export async function loadGlobalData(
  config: ResolvedConfig,
  vfs: VirtualFileSystem
): Promise<TemplateContext> {
  const data: TemplateContext = {};
  const publicEnv = loadPublicEnv(config.root);
  data["env"] = publicEnv;

  if (!existsSync(config.dataDir)) {
    return data;
  }

  try {
    const entries = readdirSync(config.dataDir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;

      let key = "";
      let isModule = false;
      let isJson = false;

      if (entry.endsWith(".json")) {
        key = entry.replace(/\.json$/, "");
        isJson = true;
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".js") || entry.endsWith(".mjs")) &&
        !entry.endsWith(".d.ts")
      ) {
        key = entry.replace(/\.(ts|js|mjs)$/, "");
        isModule = true;
      }

      if (!key) continue;

      if (isReservedNamespace(key)) {
        logWarn(
          `File "${entry}" in data/ conflicts with reserved namespace "${key}". File skipped.`
        );
        continue;
      }

      const fullPath = join(config.dataDir, entry);

      if (isJson) {
        try {
          data[key] = await vfs.readJson(fullPath);
        } catch {
          data[key] = await Bun.file(fullPath).json();
        }
      } else if (isModule) {
        try {
          const mod = await import(fullPath);
          const loader = mod.default ?? mod.load ?? mod.getData;
          if (typeof loader === "function") {
            data[key] = await loader({ env: publicEnv });
          } else if (loader !== undefined) {
            data[key] = loader;
          } else {
            data[key] = mod;
          }
        } catch (err: unknown) {
          logError(`Failed to execute global data loader "${entry}"`, err);
          throw err;
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("[Buntic Error]")) {
      throw err;
    }
    // Ignored if data directory cannot be read
  }

  return data;
}
