import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const RESERVED_NAMESPACES = new Set(["params", "props", "env"]);

/**
 * Checks if a key name is one of the reserved template namespaces.
 */
export function isReservedNamespace(name: string): boolean {
  return RESERVED_NAMESPACES.has(name);
}

/**
 * Simple zero-dependency .env format parser.
 * Handles KEY=VALUE, comments (#), and quoted values.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      // unescape newlines and quotes
      value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Loads public environment variables:
 * 1. Reads variables from `.env.public` in projectRoot (if exists).
 * 2. Scans process.env for any variable starting with "PUBLIC_".
 * 
 * Internal secrets (like DATABASE_URL, SECRET_KEY) are NEVER included.
 */
export function loadPublicEnv(projectRoot: string): Record<string, string> {
  const publicEnv: Record<string, string> = {};

  // 1. Read .env.public if it exists in the root
  const publicEnvPath = join(projectRoot, ".env.public");
  if (existsSync(publicEnvPath)) {
    try {
      const content = readFileSync(publicEnvPath, "utf-8");
      const parsed = parseEnvContent(content);
      Object.assign(publicEnv, parsed);
    } catch {
      // Ignore read errors
    }
  }

  // 2. Also incorporate any process.env variable with PUBLIC_ prefix
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("PUBLIC_") && value !== undefined) {
      publicEnv[key] = value;
    }
  }

  return publicEnv;
}
