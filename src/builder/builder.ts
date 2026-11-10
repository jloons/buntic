import { join, relative, dirname } from "node:path";
import { existsSync, readdirSync, statSync, mkdirSync, cpSync, rmSync } from "node:fs";
import type { ResolvedConfig, PageInfo, PageRouteInfo } from "../types.ts";
import { TemplateEngine } from "../template/engine.ts";
import { resolveAllRoutes } from "../router/routes.ts";
import { PhotoProcessor } from "../assets/photo-tag.ts";
import { SeoMetadataEngine } from "../seo/metadata.ts";
import { generateSitemapXml } from "../seo/sitemap.ts";
import { generateRobotsTxt } from "../seo/robots.ts";
import { generateRss2Xml, generateAtomXml } from "../seo/feeds.ts";

export interface BuildResult {
  success: boolean;
  pagesCount: number;
  outputFiles: string[];
  durationMs: number;
}

export interface BuildOptions {
  cleanCache?: boolean;
}

export class Builder {
  private config: ResolvedConfig;
  private engine: TemplateEngine;
  private photoProcessor: PhotoProcessor;
  private seoEngine: SeoMetadataEngine;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.engine = new TemplateEngine(config);
    this.photoProcessor = new PhotoProcessor(config);
    this.seoEngine = new SeoMetadataEngine(
      config,
      this.photoProcessor.imageProcessor,
      this.photoProcessor.storageManager
    );
  }

  public async build(options: BuildOptions = {}): Promise<BuildResult> {
    const startTime = performance.now();

    if (options.cleanCache) {
      await this.photoProcessor.imageProcessor.cache.clean();
    }

    // Verify no Web Component tag collisions exist before building
    this.engine.assertNoWebComponentConflicts();
    this.engine.clearUsedWebComponents();

    if (!existsSync(this.config.pagesDir)) {
      throw new Error(`[Bustatic] Pages directory not found at: ${this.config.pagesDir}`);
    }

    const globalData = await this.engine.loadData();
    const routes = await resolveAllRoutes(this.config, globalData);

    if (routes.length === 0) {
      console.warn(`[Bustatic] No HTML pages found in: ${this.config.pagesDir}`);
      return { success: true, pagesCount: 0, outputFiles: [], durationMs: 0 };
    }

    // Clean or prepare outDir
    if (existsSync(this.config.outDir)) {
      rmSync(this.config.outDir, { recursive: true, force: true });
    }
    mkdirSync(this.config.outDir, { recursive: true });

    // Temporary staging directory inside project root to preserve relative asset paths
    const stagingDir = join(this.config.root, ".bustatic-staging");
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    mkdirSync(stagingDir, { recursive: true });

    const stagedEntrypoints: string[] = [];

    try {
      // 1. Render all pages and write to stagingDir (leaving <photo> and <seo> intact for Bun.build)
      for (const route of routes) {
        const rawContent = await Bun.file(route.templateFilePath).text();
        let rendered = await this.engine.renderPage(rawContent, route.templateFilePath, {
          params: route.params,
          props: route.props,
        });

        // Write any generated scoped CSS files if in external mode before normalizing
        if (this.config.cssStrategy === "external") {
          for (const [relPath, cssContent] of this.engine.generatedPageStyles.entries()) {
            if (!relPath.startsWith("/")) {
              const stagedCssPath = join(stagingDir, relPath);
              mkdirSync(dirname(stagedCssPath), { recursive: true });
              await Bun.write(stagedCssPath, cssContent);
            }
          }
        }

        const relStagedPath = relative(this.config.outDir, route.outputFilePath);
        const stagedPath = join(stagingDir, relStagedPath);
        mkdirSync(dirname(stagedPath), { recursive: true });

        // Normalize root-relative paths (/styles/..., /components/...) to relative paths so Bun.build can resolve them
        rendered = this.normalizeRootPaths(rendered, stagedPath, stagingDir);

        await Bun.write(stagedPath, rendered);
        stagedEntrypoints.push(stagedPath);
      }

      // 2. Run Bun.build on all staged HTML pages
      const buildResult = await Bun.build({
        entrypoints: stagedEntrypoints,
        outdir: this.config.outDir,
        root: stagingDir,
        minify: this.config.minify,
        naming: {
          chunk: "[name]-[hash].[ext]",
          asset: "[name]-[hash].[ext]",
          entry: "[dir]/[name].[ext]",
        },
      });

      if (!buildResult.success) {
        for (const log of buildResult.logs) {
          console.error(log);
        }
        throw new Error("[Bustatic] Bun.build bundling failed.");
      }

      // 3. Post-bundle transform: process <photo> and <seo> on final HTML pages
      for (const route of routes) {
        if (existsSync(route.outputFilePath)) {
          let html = await Bun.file(route.outputFilePath).text();

          // 3a. Process <photo> tags -> <img> with srcset, sizes, WebP and dimensions
          html = await this.photoProcessor.processHtml(html, route.templateFilePath);

          // 3b. Process <seo> tags & route.seo -> inject canonical and social card meta tags in <head>
          html = await this.seoEngine.processSeo(html, {
            templatePath: route.templateFilePath,
            urlPath: route.urlPath,
            routeSeo: route.seo,
          });

          await Bun.write(route.outputFilePath, html);
        }
      }

      // 4. Copy public/ assets if directory exists
      if (existsSync(this.config.publicDir)) {
        cpSync(this.config.publicDir, this.config.outDir, { recursive: true });
      }

      // 5. Emit all processed images (<photo> variants and social OG cards)
      const allEmitted = [
        ...this.photoProcessor.emittedAssets.values(),
        ...this.seoEngine.emittedAssets.values(),
      ];
      for (const asset of allEmitted) {
        const fullOut = join(this.config.outDir, asset.outputPath);
        mkdirSync(dirname(fullOut), { recursive: true });
        await Bun.write(fullOut, asset.bytes);
      }

      // 6. Generate SEO artifacts: sitemap.xml, robots.txt, feeds
      const sitemapXml = generateSitemapXml(routes, this.config);
      if (sitemapXml) {
        await Bun.write(join(this.config.outDir, "sitemap.xml"), sitemapXml);
      }

      const robotsTxt = generateRobotsTxt(this.config);
      if (robotsTxt) {
        await Bun.write(join(this.config.outDir, "robots.txt"), robotsTxt);
      }

      const rssXml = generateRss2Xml(routes, this.config);
      if (rssXml) {
        const rssFilename =
          typeof this.config.feeds?.rss === "string" ? this.config.feeds.rss : "rss.xml";
        await Bun.write(join(this.config.outDir, rssFilename), rssXml);
      }

      const atomXml = generateAtomXml(routes, this.config);
      if (atomXml) {
        const atomFilename =
          typeof this.config.feeds?.atom === "string" ? this.config.feeds.atom : "atom.xml";
        await Bun.write(join(this.config.outDir, atomFilename), atomXml);
      }

      // 7. Warn about registered Web Components that are never used
      const unused = this.engine.getUnusedWebComponents();
      for (const item of unused) {
        console.warn(
          `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Web Component "<${item.tag}>" (${relative(this.config.root, item.file)}) is registered but not used in any page.`
        );
      }

      const durationMs = Math.round(performance.now() - startTime);
      const outputFiles = buildResult.outputs.map((o) => o.path);

      return {
        success: true,
        pagesCount: routes.length,
        outputFiles,
        durationMs,
      };
    } finally {
      // Clean up staging directory
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  }

  private normalizeRootPaths(html: string, stagedFilePath: string, stagingDir?: string): string {
    const fromDir = dirname(stagedFilePath);
    return html.replace(/(href|src)=["']\/([^"']+)["']/gi, (match, attr, path) => {
      // Don't modify protocol-relative, http, ws or external links or processed assets
      if (
        path.startsWith("/") ||
        path.startsWith("http:") ||
        path.startsWith("https:") ||
        path.startsWith("_bustatic") ||
        path.startsWith("assets/images/") ||
        path.startsWith("assets/seo/")
      ) {
        return match;
      }
      const targetInRoot = join(this.config.root, path);
      if (existsSync(targetInRoot)) {
        let rel = relative(fromDir, targetInRoot);
        if (!rel.startsWith(".")) rel = "./" + rel;
        return `${attr}="${rel}"`;
      }
      const targetInSrc = join(this.config.root, "src", path);
      if (existsSync(targetInSrc)) {
        let rel = relative(fromDir, targetInSrc);
        if (!rel.startsWith(".")) rel = "./" + rel;
        return `${attr}="${rel}"`;
      }
      if (stagingDir) {
        const targetInStaging = join(stagingDir, path);
        if (existsSync(targetInStaging)) {
          let rel = relative(fromDir, targetInStaging);
          if (!rel.startsWith(".")) rel = "./" + rel;
          return `${attr}="${rel}"`;
        }
      }
      return match;
    });
  }
}
