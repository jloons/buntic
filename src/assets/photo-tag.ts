import { existsSync, statSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";
import { ImageProcessor, type ProcessedVariant } from "./image-processor.ts";
import { StorageManager } from "../storage/loader.ts";
import { escapeHtml, parseHtmlAttributes, replaceLiteral } from "../utils/html.ts";
import { resolveLocalAssetPath } from "../utils/paths.ts";

export interface EmittedAsset {
  outputPath: string; // e.g. "assets/images/[hash].webp"
  url: string;        // e.g. "/assets/images/[hash].webp"
  bytes: Uint8Array;
}

const RESERVED_PHOTO_ATTRS = new Set([
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
    return parseHtmlAttributes(attrString, "");
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

      if (!src && !key) {
        throw new Error(
          `[Buntic Error] <photo> tag must have a "src" (for local files) or a "key" (for remote storage) in "${templatePath}".\n` +
            `  Found: ${match.fullMatch}`
        );
      }

      const widths = attrs.widths
        ? attrs.widths
            .split(",")
            .map((w) => parseInt(w.trim(), 10))
            .filter((w) => !isNaN(w) && w > 0)
        : undefined;

      const variants = await this.resolveVariants({
        src,
        key,
        storage,
        widths,
        templatePath,
      });

      for (const variant of variants) {
        const outFileName = `assets/images/${variant.hash}.webp`;
        const url = `/${outFileName}`;
        this.emittedAssets.set(url, {
          outputPath: outFileName,
          url,
          bytes: variant.bytes,
        });
      }

      const replacementImg = this.buildImgTag(variants, attrs, widths);
      resultHtml = replaceLiteral(resultHtml, match.fullMatch, replacementImg);
    }

    return resultHtml;
  }

  private async resolveVariants(options: {
    src?: string;
    key?: string;
    storage?: string;
    widths?: number[];
    templatePath: string;
  }): Promise<ProcessedVariant[]> {
    const { src, key, storage, widths, templatePath } = options;

    if (key) {
      const asset = await this.storageManager.fetchAsset(key, storage);
      const storageName = storage || this.storageManager.getDefaultStorageName() || "storage";

      return this.imageProcessor.processMultiWidths({
        bytes: asset.bytes,
        namespace: storageName,
        keyOrPath: key,
        etagOrMtime: asset.etag,
        widths,
      });
    }

    const localPath = resolveLocalAssetPath(this.config, src!, templatePath);
    if (!existsSync(localPath)) {
      throw new Error(
        `[Buntic Error] Local image file "${src}" referenced in <photo> not found.\n` +
          `  Looked in: "${localPath}"\n` +
          `  Referenced in: "${templatePath}"`
      );
    }

    const stats = statSync(localPath);
    const bytes = await Bun.file(localPath).bytes();

    return this.imageProcessor.processMultiWidths({
      bytes,
      namespace: "local",
      keyOrPath: localPath,
      etagOrMtime: `${stats.mtimeMs}-${stats.size}`,
      widths,
    });
  }

  private buildImgTag(
    variants: ProcessedVariant[],
    attrs: Record<string, string>,
    widths?: number[]
  ): string {
    const fallbackVariant = variants[variants.length - 1];
    const fallbackUrl = `/assets/images/${fallbackVariant.hash}.webp`;
    const fallbackSrc = this.emittedAssets.get(fallbackUrl)?.url || fallbackUrl;

    const widthVal = attrs.width || String(fallbackVariant.width);
    const heightVal = attrs.height || String(fallbackVariant.height);
    const loading = attrs.loading ?? "lazy";
    const decoding = attrs.decoding ?? "async";
    const alt = attrs.alt ?? "";

    let srcsetAttr = "";
    let sizesResult = "";
    if (variants.length > 1 || (widths && widths.length > 0)) {
      const srcsetEntries = variants.map((v) => `/assets/images/${v.hash}.webp ${v.width}w`);
      srcsetAttr = ` srcset="${srcsetEntries.join(", ")}"`;
      sizesResult = ` sizes="${attrs.sizes || "100vw"}"`;
    }

    const extraAttrsList: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (!RESERVED_PHOTO_ATTRS.has(k)) {
        extraAttrsList.push(v === "" ? k : `${k}="${escapeHtml(v)}"`);
      }
    }
    const extraAttrs = extraAttrsList.length > 0 ? " " + extraAttrsList.join(" ") : "";

    return `<img src="${fallbackSrc}"${srcsetAttr}${sizesResult} width="${widthVal}" height="${heightVal}" loading="${loading}" decoding="${decoding}" alt="${escapeHtml(alt)}"${extraAttrs}>`;
  }
}
