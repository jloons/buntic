import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { injectIntoHead, replaceLiteral } from "../utils/html.ts";
import type { CssDependencyGraph } from "./css-graph.ts";
import { extractScopedStyles, type ScopeRegistry } from "./scoped-css.ts";
import type { VirtualFileSystem } from "./vfs.ts";

/**
 * Processes `<style scoped>` blocks and manages CSS injection based on `config.cssStrategy`:
 * - `"inline"`: inlines global stylesheets and scoped styles directly into `<head>` (default).
 * - `"external"`: leaves global stylesheets as `<link>` and registers page-specific `.scoped.css` files.
 */
export async function resolvePageCss(options: {
  html: string;
  currentFile: string;
  extraScopedRules?: string[];
  config: ResolvedConfig;
  vfs: VirtualFileSystem;
  cssGraph: CssDependencyGraph;
  scopeRegistry: ScopeRegistry;
  generatedPageStyles: Map<string, string>;
}): Promise<string> {
  const {
    html,
    currentFile,
    extraScopedRules = [],
    config,
    vfs,
    cssGraph,
    scopeRegistry,
    generatedPageStyles,
  } = options;

  const { html: cleanHtml, scopedRules } = extractScopedStyles(html, scopeRegistry);
  let result = cleanHtml;

  const allScopedRules = [...scopedRules, ...extraScopedRules];
  const hasScopedRules = allScopedRules.length > 0;
  const scopedCssText = hasScopedRules ? allScopedRules.join("\n\n") : "";

  const globalRoot = cssGraph.getGlobalRoot();
  let globalCssContent: string | null = null;
  if (globalRoot.root) {
    globalCssContent = await cssGraph.flattenCss(globalRoot.root, vfs);
  }

  if (config.cssStrategy === "inline") {
    const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
    const links = Array.from(result.matchAll(linkRegex));
    let hadManualGlobalLink = false;

    for (const m of links) {
      const fullTag = m[0];
      const hrefMatch = fullTag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;

      const href = hrefMatch[1];
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
        continue;
      }

      let cssFilePath = "";
      if (href.startsWith("/")) {
        const direct = join(config.root, href.slice(1));
        const inSrc = join(config.root, "src", href.slice(1));
        if (vfs.hasFile(direct) || existsSync(direct)) {
          cssFilePath = direct;
        } else if (vfs.hasFile(inSrc) || existsSync(inSrc)) {
          cssFilePath = inSrc;
        } else {
          cssFilePath = direct;
        }
      } else {
        const fromDir = currentFile ? dirname(currentFile) : config.pagesDir;
        cssFilePath = resolve(fromDir, href);
      }

      if (vfs.hasFile(cssFilePath) || existsSync(cssFilePath)) {
        let cssContent = "";
        try {
          cssContent = await cssGraph.flattenCss(cssFilePath, vfs);
        } catch {
          cssContent = await Bun.file(cssFilePath).text();
        }

        const styleBlock = `<style id="__bustatic_global">\n${cssContent}\n</style>`;
        result = replaceLiteral(result, fullTag, styleBlock);
        hadManualGlobalLink = true;
      }
    }

    const headMatch = result.match(/<head[\s\S]*?<\/head>/i);
    const headHasGlobalStyle = headMatch ? headMatch[0].includes('id="__bustatic_global"') : false;
    if (!hadManualGlobalLink && !headHasGlobalStyle && globalCssContent) {
      const globalTag = `  <style id="__bustatic_global">\n${globalCssContent}\n</style>`;
      result = injectIntoHead(result, globalTag, "prepend");
    }

    if (hasScopedRules) {
      const scopedTag = `  <style id="__bustatic_scoped">\n${scopedCssText}\n</style>`;
      result = injectIntoHead(result, scopedTag, "append");
    }

    return result;
  }

  // "external" mode
  if (globalRoot.relativeRoot) {
    const globalPublicHref = `/${globalRoot.relativeRoot.replace(/\\/g, "/")}`;
    const withoutSrc = globalPublicHref.startsWith("/src/")
      ? globalPublicHref.slice(4)
      : globalPublicHref;
    if (!result.includes(globalPublicHref) && !result.includes(withoutSrc)) {
      const globalLink = `  <link rel="stylesheet" href="${globalPublicHref}">`;
      result = injectIntoHead(result, globalLink, "prepend");
    }
  }

  if (hasScopedRules) {
    let pageRelPath = currentFile ? relative(config.pagesDir, currentFile) : "page.html";
    if (pageRelPath.startsWith("..") || !currentFile) {
      pageRelPath = "index.html";
    }
    const scopedCssRel = pageRelPath.replace(/\.html$/, ".scoped.css");
    const scopedPublicPath = "/" + scopedCssRel.replace(/\\/g, "/");

    generatedPageStyles.set(scopedPublicPath, scopedCssText);
    generatedPageStyles.set(scopedCssRel, scopedCssText);

    const linkTag = `  <link rel="stylesheet" href="${scopedPublicPath}">`;
    result = injectIntoHead(result, linkTag, "append");
  }

  return result;
}
