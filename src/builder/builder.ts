import { join, relative, dirname } from "node:path";
import { existsSync, readdirSync, statSync, mkdirSync, cpSync, rmSync } from "node:fs";
import type { ResolvedConfig, PageInfo } from "../types.ts";
import { TemplateEngine } from "../template/engine.ts";

export interface BuildResult {
  success: boolean;
  pagesCount: number;
  outputFiles: string[];
  durationMs: number;
}

export class Builder {
  private config: ResolvedConfig;
  private engine: TemplateEngine;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.engine = new TemplateEngine(config);
  }

  public async build(): Promise<BuildResult> {
    const startTime = performance.now();

    if (!existsSync(this.config.pagesDir)) {
      throw new Error(`[Bustatic] Pages directory not found at: ${this.config.pagesDir}`);
    }

    const pages = this.findPages(this.config.pagesDir);
    if (pages.length === 0) {
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
      // 1. Render all pages and write to stagingDir
      for (const page of pages) {
        const rawContent = await Bun.file(page.absoluteFilePath).text();
        let rendered = await this.engine.renderPage(rawContent, page.absoluteFilePath);

        const stagedPath = join(stagingDir, page.relativeFilePath);
        mkdirSync(dirname(stagedPath), { recursive: true });

        // Normalize root-relative paths (/styles/..., /components/...) to relative paths so Bun.build can resolve them
        rendered = this.normalizeRootPaths(rendered, stagedPath);

        await Bun.write(stagedPath, rendered);
        stagedEntrypoints.push(stagedPath);
      }

      // 2. Run Bun.build on all staged HTML pages
      const buildResult = await Bun.build({
        entrypoints: stagedEntrypoints,
        outdir: this.config.outDir,
        root: stagingDir,
        minify: this.config.minify,
      });

      if (!buildResult.success) {
        for (const log of buildResult.logs) {
          console.error(log);
        }
        throw new Error("[Bustatic] Bun.build bundling failed.");
      }

      // 3. Copy public/ assets if directory exists
      if (existsSync(this.config.publicDir)) {
        cpSync(this.config.publicDir, this.config.outDir, { recursive: true });
      }

      const durationMs = Math.round(performance.now() - startTime);
      const outputFiles = buildResult.outputs.map((o) => o.path);

      return {
        success: true,
        pagesCount: pages.length,
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

  private findPages(dir: string, baseDir = dir): PageInfo[] {
    const results: PageInfo[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        results.push(...this.findPages(fullPath, baseDir));
      } else if (entry.endsWith(".html")) {
        const rel = relative(baseDir, fullPath);
        // Normalize urlPath: index.html -> "/", blog/index.html -> "/blog", blog/post.html -> "/blog/post"
        let url = "/" + rel.replace(/\.html$/, "");
        if (url.endsWith("/index")) {
          url = url.slice(0, -6) || "/";
        }
        results.push({
          relativeFilePath: rel,
          absoluteFilePath: fullPath,
          urlPath: url,
          outputFilePath: join(this.config.outDir, rel),
        });
      }
    }

    return results;
  }

  private normalizeRootPaths(html: string, stagedFilePath: string): string {
    const fromDir = dirname(stagedFilePath);
    return html.replace(/(href|src)=["']\/([^"']+)["']/gi, (match, attr, path) => {
      // Don't modify protocol-relative, http, ws or external links
      if (path.startsWith("/") || path.startsWith("http:") || path.startsWith("https:") || path.startsWith("_bustatic")) {
        return match;
      }
      const target = join(this.config.root, path);
      // Only rewrite if target file exists in the project root
      if (existsSync(target)) {
        let rel = relative(fromDir, target);
        if (!rel.startsWith(".")) rel = "./" + rel;
        return `${attr}="${rel}"`;
      }
      return match;
    });
  }
}
