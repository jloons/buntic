import { existsSync, statSync } from "node:fs";
import type { ResolvedConfig, PageSeo, SeoImageConfig } from "../types.ts";
import { ImageProcessor, type ProcessedVariant } from "../assets/image-processor.ts";
import { StorageManager } from "../storage/loader.ts";
import type { EmittedAsset } from "../assets/photo-tag.ts";
import { escapeHtml, injectIntoHead, parseHtmlAttributes } from "../utils/html.ts";
import { getErrorMessage, logWarn } from "../utils/logger.ts";
import { resolveLocalAssetPath } from "../utils/paths.ts";

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

    const attrs = parseHtmlAttributes(match[1], "");
    const cleanHtml = html.replace(match[0], () => "");

    let imageConfig: string | SeoImageConfig | undefined = attrs.image;
    if (attrs["image-key"] || attrs.key) {
      imageConfig = {
        key: attrs["image-key"] || attrs.key,
        storage: attrs["image-storage"] || attrs.storage,
      };
    }

    const rawCard = attrs["twitter-card"] || attrs.twitterCard;
    const twitterCard: PageSeo["twitterCard"] =
      rawCard === "summary" || rawCard === "summary_large_image" ? rawCard : undefined;

    const seo: PageSeo = {
      title: attrs.title,
      description: attrs.description,
      image: imageConfig,
      url: attrs.url,
      type: attrs.type,
      twitterCard,
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
      } catch (err: unknown) {
        logWarn(
          `Failed to process social image in "${templatePath}": ${getErrorMessage(err)}`,
          "Bustatic SEO Warning"
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
    return injectIntoHead(cleanHtml, metaTags, "prepend");
  }

  private emitSocialVariant(variant: ProcessedVariant, siteBaseUrl: string) {
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
      const asset = await this.storageManager.fetchAsset(key, storage);
      const storageName = storage || this.storageManager.getDefaultStorageName() || "storage";

      const variant = await this.imageProcessor.processSocialImage({
        bytes: asset.bytes,
        namespace: storageName,
        keyOrPath: key,
        etagOrMtime: asset.etag,
      });

      return this.emitSocialVariant(variant, siteBaseUrl);
    }

    if (src) {
      if (src.startsWith("http://") || src.startsWith("https://")) {
        return { url: src, width: 1200, height: 630 };
      }

      const localPath = resolveLocalAssetPath(this.config, src, templatePath);
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

      return this.emitSocialVariant(variant, siteBaseUrl);
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
}
