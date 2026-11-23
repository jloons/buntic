import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { PageRouteInfo, ResolvedConfig } from "../types.ts";
import { PhotoProcessor } from "../assets/photo-tag.ts";
import { resolveAllRoutes } from "../router/routes.ts";
import { generateAtomXml, generateRss2Xml } from "../seo/feeds.ts";
import { SeoMetadataEngine } from "../seo/metadata.ts";
import { generateRobotsTxt } from "../seo/robots.ts";
import { generateSitemapXml } from "../seo/sitemap.ts";
import { TemplateEngine } from "../template/engine.ts";
import { logWarn } from "../utils/logger.ts";
import {
  assertNoPublicCollisions,
  detectPublicCollisions,
  getDirectoryFiles,
  type PublicCollision,
} from "./collisions.ts";

export {
  assertNoPublicCollisions,
  detectPublicCollisions,
  getDirectoryFiles,
  type PublicCollision,
};

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

    this.engine.assertNoWebComponentConflicts();
    this.engine.clearUsedWebComponents();

    if (!existsSync(this.config.pagesDir)) {
      throw new Error(`[Buntic] Pages directory not found at: ${this.config.pagesDir}`);
    }

    const globalData = await this.engine.loadData();
    const routes = await resolveAllRoutes(this.config, globalData);

    if (routes.length === 0) {
      console.warn(`[Buntic] No HTML pages found in: ${this.config.pagesDir}`);
      return { success: true, pagesCount: 0, outputFiles: [], durationMs: 0 };
    }

    assertNoPublicCollisions(this.config, routes);
    this.prepareEmptyDir(this.config.outDir);

    const stagingDir = join(this.config.root, ".buntic-staging");
    this.prepareEmptyDir(stagingDir);

    try {
      const stagedEntrypoints = await this.stagePages(routes, stagingDir);
      const outputFiles = await this.bundleStagedPages(stagedEntrypoints, stagingDir);
      await this.postProcessHtmlPages(routes);

      if (existsSync(this.config.publicDir)) {
        cpSync(this.config.publicDir, this.config.outDir, { recursive: true });
      }

      await this.emitProcessedAssets();
      await this.emitSeoArtifacts(routes);
      this.warnUnusedWebComponents();

      return {
        success: true,
        pagesCount: routes.length,
        outputFiles,
        durationMs: Math.round(performance.now() - startTime),
      };
    } finally {
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  }

  private prepareEmptyDir(dir: string): void {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(dir, { recursive: true });
  }

  private async stagePages(routes: PageRouteInfo[], stagingDir: string): Promise<string[]> {
    const stagedEntrypoints: string[] = [];

    for (const route of routes) {
      const rawContent = await Bun.file(route.templateFilePath).text();
      let rendered = await this.engine.renderPage(rawContent, route.templateFilePath, {
        params: route.params,
        props: route.props,
      });

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

      rendered = this.normalizeRootPaths(rendered, stagedPath, stagingDir);
      await Bun.write(stagedPath, rendered);
      stagedEntrypoints.push(stagedPath);
    }

    return stagedEntrypoints;
  }

  private async bundleStagedPages(
    stagedEntrypoints: string[],
    stagingDir: string
  ): Promise<string[]> {
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
      external: ["/*"],
    });

    if (!buildResult.success) {
      for (const log of buildResult.logs) {
        console.error(log);
      }
      throw new Error("[Buntic] Bun.build bundling failed.");
    }

    return buildResult.outputs.map((o) => o.path);
  }

  private async postProcessHtmlPages(routes: PageRouteInfo[]): Promise<void> {
    for (const route of routes) {
      if (!existsSync(route.outputFilePath)) continue;

      let html = await Bun.file(route.outputFilePath).text();
      html = await this.photoProcessor.processHtml(html, route.templateFilePath);
      html = await this.seoEngine.processSeo(html, {
        templatePath: route.templateFilePath,
        urlPath: route.urlPath,
        routeSeo: route.seo,
      });

      await Bun.write(route.outputFilePath, html);
    }
  }

  private async emitProcessedAssets(): Promise<void> {
    const allEmitted = [
      ...this.photoProcessor.emittedAssets.values(),
      ...this.seoEngine.emittedAssets.values(),
    ];
    for (const asset of allEmitted) {
      const fullOut = join(this.config.outDir, asset.outputPath);
      mkdirSync(dirname(fullOut), { recursive: true });
      await Bun.write(fullOut, asset.bytes);
    }
  }

  private async emitSeoArtifacts(routes: PageRouteInfo[]): Promise<void> {
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
  }

  private warnUnusedWebComponents(): void {
    const unused = this.engine.getUnusedWebComponents();
    for (const item of unused) {
      logWarn(
        `Web Component "<${item.tag}>" (${relative(this.config.root, item.file)}) is registered but not used in any page.`
      );
    }
  }

  private normalizeRootPaths(html: string, stagedFilePath: string, stagingDir?: string): string {
    const fromDir = dirname(stagedFilePath);
    return html.replace(/(href|src)=["']\/([^"']+)["']/gi, (match, attr, path) => {
      if (
        path.startsWith("/") ||
        path.startsWith("http:") ||
        path.startsWith("https:") ||
        path.startsWith("_buntic") ||
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
