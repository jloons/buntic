import { join, basename, extname } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { ResolvedConfig, StorageAssetResult, StorageLoaderFn } from "../types.ts";

export interface LoadedStorage {
  name: string;
  filePath: string;
  loaderFn: StorageLoaderFn;
}

export class StorageManager {
  private config: ResolvedConfig;
  private storages: Map<string, LoadedStorage> = new Map();
  private initialized = false;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.storages.clear();

    if (!existsSync(this.config.storageDir) || !statSync(this.config.storageDir).isDirectory()) {
      this.initialized = true;
      return;
    }

    const entries = readdirSync(this.config.storageDir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const ext = extname(entry);
      if (![".ts", ".js", ".mjs"].includes(ext)) continue;

      const fullPath = join(this.config.storageDir, entry);
      const name = basename(entry, ext);

      try {
        const mod = await import(`${fullPath}?t=${Date.now()}`);
        const loaderFn = mod.default || mod.getAsset || mod.loader;

        if (typeof loaderFn !== "function") {
          console.warn(
            `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Storage loader "${entry}" in "${this.config.storageDir}" must export a default function. Skipping.`
          );
          continue;
        }

        this.storages.set(name, {
          name,
          filePath: fullPath,
          loaderFn,
        });
      } catch (err: any) {
        console.error(
          `\x1b[31m[Bustatic Error]\x1b[0m Failed to load storage loader "${entry}":`,
          err?.message || err
        );
        throw err;
      }
    }

    this.initialized = true;
  }

  public getAvailableStorages(): string[] {
    return Array.from(this.storages.keys());
  }

  public getDefaultStorageName(): string | undefined {
    if (this.config.defaultStorage && this.storages.has(this.config.defaultStorage)) {
      return this.config.defaultStorage;
    }
    const names = this.getAvailableStorages();
    if (names.length === 1) {
      return names[0];
    }
    return undefined;
  }

  public async fetchAsset(key: string, storageName?: string): Promise<StorageAssetResult> {
    await this.init();

    const targetStorage = storageName || this.getDefaultStorageName();
    const available = this.getAvailableStorages();

    if (!targetStorage) {
      if (available.length === 0) {
        throw new Error(
          `[Bustatic Error] No storage loaders found in "${this.config.storageDir}".\n` +
          `👉 Create a storage loader (e.g. "${join(this.config.storageDir, "s3.ts")}") to handle key "${key}".`
        );
      }
      throw new Error(
        `[Bustatic Error] Multiple storage loaders detected ([${available.join(", ")}]), but no storage name was specified for key "${key}".\n` +
        `👉 Specify storage="..." in your tag or set "defaultStorage" in bustatic.config.ts.`
      );
    }

    const storage = this.storages.get(targetStorage);
    if (!storage) {
      throw new Error(
        `[Bustatic Error] Storage loader "${targetStorage}" not found in "${this.config.storageDir}".\n` +
        `  Available storages: [${available.join(", ")}]`
      );
    }

    try {
      const rawResult = await storage.loaderFn(key);
      return normalizeStorageResult(rawResult, key, targetStorage);
    } catch (err: any) {
      console.error(
        `\x1b[31m[Bustatic Error]\x1b[0m Error fetching asset "${key}" from storage "${targetStorage}":`,
        err?.message || err
      );
      throw err;
    }
  }
}

async function normalizeStorageResult(
  result: any,
  key: string,
  storageName: string
): Promise<StorageAssetResult> {
  if (!result) {
    throw new Error(
      `[Bustatic Error] Storage loader "${storageName}" returned null/undefined for key "${key}".`
    );
  }

  // Response object (fetch or new Response)
  if (result instanceof Response) {
    const arrayBuf = await result.arrayBuffer();
    return {
      bytes: new Uint8Array(arrayBuf),
      etag: result.headers.get("etag") || undefined,
      contentType: result.headers.get("content-type") || undefined,
    };
  }

  // BunFile object (e.g. s3.file(key))
  if (typeof result === "object" && typeof result.bytes === "function") {
    const bytes = await result.bytes();
    let etag: string | undefined;
    let contentType: string | undefined;
    if (typeof result.stat === "function") {
      try {
        const st = await result.stat();
        etag = st?.etag;
        contentType = st?.type;
      } catch {
        // ignore if stat fails
      }
    }
    return {
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      etag,
      contentType,
    };
  }

  // Object with bytes property: { bytes, etag, contentType }
  if (typeof result === "object" && result.bytes) {
    let bytes: Uint8Array;
    if (result.bytes instanceof Uint8Array) {
      bytes = result.bytes;
    } else if (result.bytes instanceof ArrayBuffer) {
      bytes = new Uint8Array(result.bytes);
    } else if (typeof result.bytes === "function") {
      bytes = await result.bytes();
    } else {
      bytes = new Uint8Array(result.bytes);
    }

    return {
      bytes,
      etag: result.etag || undefined,
      contentType: result.contentType || undefined,
    };
  }

  // Raw Uint8Array
  if (result instanceof Uint8Array) {
    return {
      bytes: result,
    };
  }

  // Raw ArrayBuffer
  if (result instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(result),
    };
  }

  throw new Error(
    `[Bustatic Error] Unsupported return type from storage loader "${storageName}" for key "${key}".\n` +
    `  Expected Uint8Array, ArrayBuffer, Response, BunFile or { bytes, etag?, contentType? }. Received: ${typeof result}`
  );
}
