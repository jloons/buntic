import { join, resolve, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { ResolvedConfig, PageSeo, SeoImageConfig } from "../types.ts";
import { ImageProcessor } from "../assets/image-processor.ts";
import { StorageManager } from "../storage/loader.ts";
import type { EmittedAsset } from "../assets/photo-tag.ts";

export interface HeadSeoData {
  title?: string;
  description?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  url?: string;
  type?: string;
  twitterCard?: string;
}

export class SeoMetadataEngine {
  private config: ResolvedConfig;
  private imageProcessor: ImageProcessor;
  private storageManager: StorageManager;
  public emittedAssets: Map<string, EmittedAsset> = new Map();

  constructor(
    config: ResolvedConfig,
    imageProcessor?: ImageProcessor,
    storageManager?: StorageManager
  ) {
    this.config = config;
    this.imageProcessor = imageProcessor || new ImageProcessor(config);
    this.storageManager = storageManager || new StorageManager(config);
  }

  public parseSeoTag(html: string): { seo: PageSeo | null; cleanHtml: string } {
    const seoRegex = /<seo\b([^>]*?)(?:\/>|>[\s\S]*?<\/seo>|>)/i;
    const match = seoRegex.exec(html);

    if (!match) {
      return { seo: null, cleanHtml: html };
    }

    const attrString = match[1];
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z0-9_\-:@]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrString)) !== null) {
      attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
    }

    const cleanHtml = html.replace(match[0], "");

    let imageConfig: string | SeoImageConfig | undefined = attrs.image;
    if (attrs["image-key"] || attrs.key) {
      imageConfig = {
        key: attrs["image-key"] || attrs.key,
        storage: attrs["image-storage"] || attrs.storage,
      };
    }

    const seo: PageSeo = {
      title: attrs.title,
      description: attrs.description,
      image: imageConfig,
      url: attrs.url,
      type: attrs.type,
      twitterCard: (attrs["twitter-card"] as any) || attrs.twitterCard,
    };

    return { seo, cleanHtml };
  }

  public async processSeo(
    html: string,
    options: {
      templatePath: string;
      urlPath: string;
      routeSeo?: PageSeo;
    }
  ): Promise<string> {
    const { templatePath, urlPath, routeSeo } = options;

    // 1. Extract <seo> tag from HTML if present
    const { seo: tagSeo, cleanHtml } = this.parseSeoTag(html);

    // 2. Cascade hierarchy: Config.site -> Tag in Layout/Page -> route.seo
    const baseTitle = this.config.site?.title;
    const baseDescription = this.config.site?.description;
    const baseImage = this.config.site?.defaultOgImage;

    const mergedTitle = routeSeo?.title || tagSeo?.title || baseTitle;
    const mergedDescription = routeSeo?.description || tagSeo?.description || baseDescription;
    const rawImage = routeSeo?.image || tagSeo?.image || baseImage;
    const pageType = routeSeo?.type || tagSeo?.type || "website";
    const twitterCard = routeSeo?.twitterCard || tagSeo?.twitterCard || "summary_large_image";

    const siteBaseUrl = this.config.site?.url ? this.config.site.url.replace(/\/+$/, "") : "";
    const canonicalUrl = siteBaseUrl
      ? `${siteBaseUrl}${urlPath === "/" ? "" : urlPath}`
      : urlPath;

    // 3. Process social image if specified
    let finalImageUrl: string | undefined;
    let imgWidth: number | undefined;
    let imgHeight: number | undefined;

    if (rawImage) {
      try {
        const processed = await this.resolveAndProcessSocialImage(
          rawImage,
          templatePath
        );
        if (processed) {
          finalImageUrl = processed.url;
          imgWidth = processed.width;
          imgHeight = processed.height;
        }
      } catch (err: any) {
        console.warn(
          `\x1b[33m⚠ [Bustatic SEO Warning]\x1b[0m Failed to process social image in "${templatePath}": ${err?.message || err}`
        );
      }
    }

    // 4. Generate meta tags
    const metaTags = this.generateMetaTagsHtml({
      title: mergedTitle,
      description: mergedDescription,
      image: finalImageUrl,
      imageWidth: imgWidth,
      imageHeight: imgHeight,
      url: canonicalUrl,
      type: pageType,
      twitterCard,
    });

    // 5. Inject into <head>
    return this.injectIntoHead(cleanHtml, metaTags);
  }

  private async resolveAndProcessSocialImage(
    imageConfig: string | SeoImageConfig,
    templatePath: string
  ): Promise<{ url: string; width: number; height: number } | null> {
    const siteBaseUrl = this.config.site?.url ? this.config.site.url.replace(/\/+$/, "") : "";

    let key: string | undefined;
    let storage: string | undefined;
    let src: string | undefined;

    if (typeof imageConfig === "string") {
      if (imageConfig.startsWith("http://") || imageConfig.startsWith("https://")) {
        return { url: imageConfig, width: 1200, height: 630 };
      }
      src = imageConfig;
    } else {
      key = imageConfig.key;
      storage = imageConfig.storage;
      src = imageConfig.src;
    }

    if (key) {
      // Remote storage asset
      const asset = await this.storageManager.fetchAsset(key, storage);
      const storageName = storage || this.storageManager.getDefaultStorageName() || "storage";

      const variant = await this.imageProcessor.processSocialImage({
        bytes: asset.bytes,
        namespace: storageName,
        keyOrPath: key,
        etagOrMtime: asset.etag,
      });

      const outFileName = `assets/seo/${variant.hash}.webp`;
      const localUrl = `/${outFileName}`;
      this.emittedAssets.set(localUrl, {
        outputPath: outFileName,
        url: localUrl,
        bytes: variant.bytes,
      });

      return {
        url: siteBaseUrl ? `${siteBaseUrl}${localUrl}` : localUrl,
        width: variant.width,
        height: variant.height,
      };
    }

    if (src) {
      if (src.startsWith("http://") || src.startsWith("https://")) {
        return { url: src, width: 1200, height: 630 };
      }

      let localPath: string;
      if (src.startsWith("/")) {
        const fromPublic = join(this.config.publicDir, src.slice(1));
        localPath = existsSync(fromPublic) ? fromPublic : join(this.config.root, src.slice(1));
      } else {
        localPath = resolve(dirname(templatePath), src);
      }

      if (!existsSync(localPath)) {
        return null;
      }

      const stats = statSync(localPath);
      const bytes = await Bun.file(localPath).bytes();

      const variant = await this.imageProcessor.processSocialImage({
        bytes,
        namespace: "local",
        keyOrPath: localPath,
        etagOrMtime: `${stats.mtimeMs}-${stats.size}`,
      });

      const outFileName = `assets/seo/${variant.hash}.webp`;
      const localUrl = `/${outFileName}`;
      this.emittedAssets.set(localUrl, {
        outputPath: outFileName,
        url: localUrl,
        bytes: variant.bytes,
      });

      return {
        url: siteBaseUrl ? `${siteBaseUrl}${localUrl}` : localUrl,
        width: variant.width,
        height: variant.height,
      };
    }

    return null;
  }

  private generateMetaTagsHtml(data: HeadSeoData): string {
    const lines: string[] = [];

    if (data.title) {
      lines.push(`    <title>${escapeHtml(data.title)}</title>`);
      lines.push(`    <meta property="og:title" content="${escapeHtml(data.title)}">`);
      lines.push(`    <meta name="twitter:title" content="${escapeHtml(data.title)}">`);
    }

    if (data.description) {
      lines.push(`    <meta name="description" content="${escapeHtml(data.description)}">`);
      lines.push(`    <meta property="og:description" content="${escapeHtml(data.description)}">`);
      lines.push(`    <meta name="twitter:description" content="${escapeHtml(data.description)}">`);
    }

    if (data.url) {
      lines.push(`    <link rel="canonical" href="${escapeHtml(data.url)}">`);
      lines.push(`    <meta property="og:url" content="${escapeHtml(data.url)}">`);
    }

    if (data.type) {
      lines.push(`    <meta property="og:type" content="${escapeHtml(data.type)}">`);
    }

    if (data.image) {
      lines.push(`    <meta property="og:image" content="${escapeHtml(data.image)}">`);
      if (data.imageWidth) {
        lines.push(`    <meta property="og:image:width" content="${data.imageWidth}">`);
      }
      if (data.imageHeight) {
        lines.push(`    <meta property="og:image:height" content="${data.imageHeight}">`);
      }
      lines.push(`    <meta name="twitter:image" content="${escapeHtml(data.image)}">`);
    }

    if (data.twitterCard) {
      lines.push(`    <meta name="twitter:card" content="${escapeHtml(data.twitterCard)}">`);
    }

    return lines.join("\n");
  }

  private injectIntoHead(html: string, metaTags: string): string {
    if (!metaTags.trim()) {
      return html;
    }

    // If <head> exists, insert before </head>
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${metaTags}\n  </head>`);
    }

    // If <html> exists, insert <head>
    if (/<html\b[^>]*>/i.test(html)) {
      return html.replace(/(<html\b[^>]*>)/i, `$1\n  <head>\n${metaTags}\n  </head>`);
    }

    // Prepend to document
    return `<head>\n${metaTags}\n</head>\n${html}`;
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
