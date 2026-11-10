import { join, resolve, dirname, isAbsolute } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";
import { ImageProcessor, type ProcessedVariant } from "./image-processor.ts";
import { StorageManager } from "../storage/loader.ts";

export interface EmittedAsset {
  outputPath: string; // e.g. "assets/images/[hash].webp"
  url: string;        // e.g. "/assets/images/[hash].webp"
  bytes: Uint8Array;
}

export class PhotoProcessor {
  private config: ResolvedConfig;
  public imageProcessor: ImageProcessor;
  public storageManager: StorageManager;
  public emittedAssets: Map<string, EmittedAsset> = new Map();

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.imageProcessor = new ImageProcessor(config);
    this.storageManager = new StorageManager(config);
  }

  public parseAttributes(attrString: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z0-9_\-:@]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(attrString)) !== null) {
      const name = match[1];
      const val = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[name] = val;
    }
    return attrs;
  }

  public async processHtml(html: string, templatePath: string): Promise<string> {
    const photoRegex = /<photo\b([^>]*?)(?:\/>|>[\s\S]*?<\/photo>|>)/gi;
    const matches: Array<{ fullMatch: string; attrString: string }> = [];

    let m: RegExpExecArray | null;
    while ((m = photoRegex.exec(html)) !== null) {
      matches.push({ fullMatch: m[0], attrString: m[1] });
    }

    if (matches.length === 0) {
      return html;
    }

    let resultHtml = html;

    for (const match of matches) {
      const attrs = this.parseAttributes(match.attrString);

      const src = attrs.src;
      const key = attrs.key;
      const storage = attrs.storage;
      const alt = attrs.alt ?? "";
      const sizesAttr = attrs.sizes;
      const loading = attrs.loading ?? "lazy";
      const decoding = attrs.decoding ?? "async";

      if (!src && !key) {
        throw new Error(
          `[Bustatic Error] <photo> tag must have a "src" (for local files) or a "key" (for remote storage) in "${templatePath}".\n` +
          `  Found: ${match.fullMatch}`
        );
      }

      let variants: ProcessedVariant[];
      let widths: number[] | undefined;
      if (attrs.widths) {
        widths = attrs.widths
          .split(",")
          .map((w) => parseInt(w.trim(), 10))
          .filter((w) => !isNaN(w) && w > 0);
      }

      if (key) {
        // Remote storage asset
        const asset = await this.storageManager.fetchAsset(key, storage);
        const storageName = storage || this.storageManager.getDefaultStorageName() || "storage";

        variants = await this.imageProcessor.processMultiWidths({
          bytes: asset.bytes,
          namespace: storageName,
          keyOrPath: key,
          etagOrMtime: asset.etag,
          widths,
        });
      } else {
        // Local asset
        const localPath = this.resolveLocalImagePath(src!, templatePath);
        if (!existsSync(localPath)) {
          throw new Error(
            `[Bustatic Error] Local image file "${src}" referenced in <photo> not found.\n` +
            `  Looked in: "${localPath}"\n` +
            `  Referenced in: "${templatePath}"`
          );
        }

        const stats = statSync(localPath);
        const bytes = await Bun.file(localPath).bytes();

        variants = await this.imageProcessor.processMultiWidths({
          bytes,
          namespace: "local",
          keyOrPath: localPath,
          etagOrMtime: `${stats.mtimeMs}-${stats.size}`,
          widths,
        });
      }

      // Record emitted assets
      for (const variant of variants) {
        const outFileName = `assets/images/${variant.hash}.webp`;
        const url = `/${outFileName}`;
        this.emittedAssets.set(url, {
          outputPath: outFileName,
          url,
          bytes: variant.bytes,
        });
      }

      // Build replacement <img>
      const fallbackVariant = variants[variants.length - 1]; // largest or single
      const fallbackSrc = `/${this.emittedAssets.get(`assets/images/${fallbackVariant.hash}.webp`)?.outputPath || `assets/images/${fallbackVariant.hash}.webp`}`;

      // Calculate width/height for anti-CLS
      const widthVal = attrs.width || String(fallbackVariant.width);
      const heightVal = attrs.height || String(fallbackVariant.height);

      let srcsetAttr = "";
      let sizesResult = "";
      if (variants.length > 1 || (widths && widths.length > 0)) {
        const srcsetEntries = variants.map((v) => `/assets/images/${v.hash}.webp ${v.width}w`);
        srcsetAttr = ` srcset="${srcsetEntries.join(", ")}"`;
        sizesResult = ` sizes="${sizesAttr || "100vw"}"`;
      }

      // Collect passthrough attributes (class, style, id, etc.)
      const reserved = new Set([
        "src",
        "key",
        "storage",
        "widths",
        "sizes",
        "width",
        "height",
        "loading",
        "decoding",
        "alt",
      ]);

      const extraAttrsList: string[] = [];
      for (const [k, v] of Object.entries(attrs)) {
        if (!reserved.has(k)) {
          extraAttrsList.push(v === "" ? k : `${k}="${v}"`);
        }
      }
      const extraAttrs = extraAttrsList.length > 0 ? " " + extraAttrsList.join(" ") : "";

      const replacementImg = `<img src="${fallbackSrc}"${srcsetAttr}${sizesResult} width="${widthVal}" height="${heightVal}" loading="${loading}" decoding="${decoding}" alt="${escapeHtml(alt)}"${extraAttrs}>`;

      resultHtml = resultHtml.replace(match.fullMatch, replacementImg);
    }

    return resultHtml;
  }

  private resolveLocalImagePath(src: string, templatePath: string): string {
    if (src.startsWith("/")) {
      const fromPublic = join(this.config.publicDir, src.slice(1));
      if (existsSync(fromPublic)) {
        return fromPublic;
      }
      const fromRoot = join(this.config.root, src.slice(1));
      return fromRoot;
    }

    return resolve(dirname(templatePath), src);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
