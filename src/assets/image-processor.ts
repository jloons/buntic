import type { ResolvedConfig } from "../types.ts";
import { AssetCache } from "./cache.ts";

export interface ProcessedVariant {
  bytes: Uint8Array;
  width: number;
  height: number;
  hash: string;
}

export class ImageProcessor {
  public cache: AssetCache;
  private ramCache: Map<string, ProcessedVariant> = new Map();

  constructor(config: ResolvedConfig) {
    this.cache = new AssetCache(config.cacheDir);
  }

  public async getMetadata(bytes: Uint8Array): Promise<{ width: number; height: number; format: string }> {
    const img = new Bun.Image(bytes);
    const meta = await img.metadata();
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format || "unknown",
    };
  }

  public async processImage(options: {
    bytes: Uint8Array;
    namespace: string;
    keyOrPath: string;
    etagOrMtime?: string | number;
    targetWidth?: number;
  }): Promise<ProcessedVariant> {
    const { bytes, namespace, keyOrPath, etagOrMtime, targetWidth } = options;

    return this.getOrComputeVariant({
      namespace,
      hashParts: [
        namespace,
        keyOrPath,
        etagOrMtime ?? bytes.length,
        targetWidth ? `${targetWidth}w` : "orig",
        "webp",
      ],
      compute: async () => {
        const originalMeta = await this.getMetadata(bytes);
        let img = new Bun.Image(bytes);
        let finalWidth = originalMeta.width;
        let finalHeight = originalMeta.height;

        if (targetWidth && targetWidth > 0 && targetWidth < originalMeta.width) {
          finalWidth = targetWidth;
          finalHeight = Math.max(1, Math.round((originalMeta.height / originalMeta.width) * targetWidth));
          img = await img.resize(finalWidth, finalHeight);
        }

        const webpImg = await img.webp();
        const finalBytes = await webpImg.bytes();

        return {
          bytes: finalBytes,
          width: finalWidth,
          height: finalHeight,
        };
      },
    });
  }

  public async processMultiWidths(options: {
    bytes: Uint8Array;
    namespace: string;
    keyOrPath: string;
    etagOrMtime?: string | number;
    widths?: number[];
  }): Promise<ProcessedVariant[]> {
    const { bytes, namespace, keyOrPath, etagOrMtime, widths } = options;

    if (!widths || widths.length === 0) {
      const orig = await this.processImage({
        bytes,
        namespace,
        keyOrPath,
        etagOrMtime,
      });
      return [orig];
    }

    const meta = await this.getMetadata(bytes);
    const sortedWidths = Array.from(new Set(widths))
      .filter((w) => w > 0 && w <= meta.width)
      .sort((a, b) => a - b);

    if (sortedWidths.length === 0) {
      const orig = await this.processImage({
        bytes,
        namespace,
        keyOrPath,
        etagOrMtime,
      });
      return [orig];
    }

    const results: ProcessedVariant[] = [];
    for (const w of sortedWidths) {
      const variant = await this.processImage({
        bytes,
        namespace,
        keyOrPath,
        etagOrMtime,
        targetWidth: w,
      });
      results.push(variant);
    }

    return results;
  }

  public async processSocialImage(options: {
    bytes: Uint8Array;
    namespace: string;
    keyOrPath: string;
    etagOrMtime?: string | number;
  }): Promise<ProcessedVariant> {
    const { bytes, namespace, keyOrPath, etagOrMtime } = options;

    return this.getOrComputeVariant({
      namespace,
      hashParts: [
        namespace,
        keyOrPath,
        etagOrMtime ?? bytes.length,
        "social-1200x630",
        "webp",
      ],
      compute: async () => {
        const img = new Bun.Image(bytes);
        const resized = await img.resize(1200, 630);
        const webpImg = await resized.webp();
        const finalBytes = await webpImg.bytes();

        return {
          bytes: finalBytes,
          width: 1200,
          height: 630,
        };
      },
    });
  }

  private async getOrComputeVariant(options: {
    namespace: string;
    hashParts: (string | number | undefined | null)[];
    compute: () => Promise<{ bytes: Uint8Array; width: number; height: number }>;
  }): Promise<ProcessedVariant> {
    const { namespace, hashParts, compute } = options;
    const hash = this.cache.computeHash(hashParts);
    const ramKey = `${namespace}:${hash}`;

    const fromRam = this.ramCache.get(ramKey);
    if (fromRam) {
      return fromRam;
    }

    const cachedBytes = await this.cache.get(namespace, hash, "webp");
    if (cachedBytes) {
      try {
        const meta = await this.getMetadata(cachedBytes);
        const result: ProcessedVariant = {
          bytes: cachedBytes,
          width: meta.width,
          height: meta.height,
          hash,
        };
        this.ramCache.set(ramKey, result);
        return result;
      } catch {
        // Re-process if cached file is corrupted
      }
    }

    const computed = await compute();
    await this.cache.set(namespace, hash, computed.bytes, "webp");

    const result: ProcessedVariant = {
      bytes: computed.bytes,
      width: computed.width,
      height: computed.height,
      hash,
    };

    this.ramCache.set(ramKey, result);
    return result;
  }
}
