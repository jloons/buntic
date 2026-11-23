import { relative } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { injectIntoHead } from "../utils/html.ts";
import { logWarn } from "../utils/logger.ts";
import type { CssDependencyGraph } from "./css-graph.ts";
import { interpolateTemplate, resolveConditionals } from "./directives.ts";
import { extractScopedStyles, type ScopeRegistry } from "./scoped-css.ts";
import type { VirtualFileSystem } from "./vfs.ts";
import { findTriadForScript, RESERVED_W3C_TAGS } from "./web-components.ts";

/**
 * Checks whether an HTML string already contains a `<script>` tag pointing to `srcPath`.
 */
export function hasScriptWithSrc(html: string, srcPath: string): boolean {
  const cleanSrc = srcPath.replace(/^\/+/, "");
  const scriptRegex = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRegex.exec(html)) !== null) {
    const existingSrc = m[1].replace(/^\/+/, "");
    if (existingSrc === cleanSrc || existingSrc.endsWith("/" + cleanSrc)) {
      return true;
    }
  }
  return false;
}

/**
 * Scans HTML for Custom Element tags (e.g. `<counter-button>`), expands Declarative Shadow DOM
 * (`<template shadowrootmode="open">`) recursively when triad `.html`/`.css` files exist,
 * and auto-injects the corresponding `<script type="module" src="...">` into `<head>`.
 */
export async function resolveWebComponentsInHtml(options: {
  html: string;
  context: Record<string, unknown>;
  config: ResolvedConfig;
  vfs: VirtualFileSystem;
  cssGraph: CssDependencyGraph;
  scopeRegistry: ScopeRegistry;
  warnedUnknownTags: Set<string>;
  resolveComponentsFn: (
    html: string,
    context: Record<string, unknown>,
    currentFile: string
  ) => Promise<string>;
}): Promise<string> {
  const {
    html,
    context,
    config,
    vfs,
    cssGraph,
    scopeRegistry,
    warnedUnknownTags,
    resolveComponentsFn,
  } = options;

  const scriptsToInject: string[] = [];
  const injectedPaths = new Set<string>();

  let result = html;
  const globalRoot = cssGraph.getGlobalRoot();
  let globalCssBlock = "";
  if (globalRoot.root) {
    if (config.cssStrategy === "inline") {
      const globalCss = await cssGraph.flattenCss(globalRoot.root, vfs);
      globalCssBlock = `<style data-buntic="global">\n${globalCss.trim()}\n</style>`;
    } else if (globalRoot.relativeRoot) {
      const globalPublicHref = `/${globalRoot.relativeRoot.replace(/\\/g, "/")}`;
      globalCssBlock = `<link rel="stylesheet" href="${globalPublicHref}">`;
    }
  }

  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    iterations++;
    const tagRegex = /<([a-z][a-z0-9]*-[a-z0-9-]*)/gi;
    let match: RegExpExecArray | null;
    const discoveredTags = new Set<string>();

    while ((match = tagRegex.exec(result)) !== null) {
      discoveredTags.add(match[1].toLowerCase());
    }

    let modified = false;

    for (const tag of discoveredTags) {
      const scriptPath = vfs.registry.findScriptForTag(tag);
      if (!scriptPath) {
        if (!RESERVED_W3C_TAGS.has(tag) && !warnedUnknownTags.has(tag)) {
          warnedUnknownTags.add(tag);
          logWarn(
            `Custom Element "<${tag}>" was found in HTML, but no matching Web Component file was found in the project.`
          );
        }
        continue;
      }

      vfs.registry.markTagUsed(tag);
      const rel = relative(config.root, scriptPath).replace(/\\/g, "/");
      const publicSrc = rel.startsWith("/") ? rel : `/${rel}`;

      if (!injectedPaths.has(publicSrc) && !hasScriptWithSrc(result, publicSrc)) {
        injectedPaths.add(publicSrc);
        scriptsToInject.push(`<script type="module" src="${publicSrc}"></script>`);
      }

      const triad = findTriadForScript(scriptPath, (p) => vfs.hasFile(p));
      if (!triad || (!triad.htmlPath && !triad.cssPath)) continue;

      const elementRegex = new RegExp(`<${tag}(\\s+[^>]*?)?(\\s*\\/?)>`, "gi");
      let hasUnexpanded = false;
      result.replace(elementRegex, (fullMatch, _attrs, _selfClose, offset, fullString) => {
        const remainder = fullString.slice(offset + fullMatch.length).trimStart();
        if (!remainder.startsWith("<template") || !remainder.includes("shadowrootmode=")) {
          hasUnexpanded = true;
        }
        return fullMatch;
      });

      if (!hasUnexpanded) continue;

      let siblingCssBlock = "";
      if (triad.cssPath) {
        let siblingCss = "";
        try {
          siblingCss = await cssGraph.flattenCss(triad.cssPath, vfs);
        } catch {
          siblingCss = await Bun.file(triad.cssPath).text();
        }

        siblingCss = siblingCss.replace(/(^|[^a-zA-Z0-9_-])&(?![\w-])/g, "$1:host");
        if (siblingCss.trim().length > 0) {
          siblingCssBlock = `<style>\n${siblingCss.trim()}\n</style>`;
        }
      }

      let templateHtml = "<slot></slot>";
      let scopedDsdCssBlock = "";
      if (triad.htmlPath) {
        let rawHtml = "";
        try {
          rawHtml = await vfs.readText(triad.htmlPath);
        } catch {
          rawHtml = await Bun.file(triad.htmlPath).text();
        }
        rawHtml = await resolveComponentsFn(rawHtml, context, triad.htmlPath);
        rawHtml = resolveConditionals(rawHtml, context);
        rawHtml = interpolateTemplate(rawHtml, context);

        if (rawHtml.includes("<style") && rawHtml.includes("scoped")) {
          const extracted = extractScopedStyles(rawHtml, scopeRegistry);
          rawHtml = extracted.html;
          if (extracted.scopedRules.length > 0) {
            scopedDsdCssBlock = `<style data-buntic="dsd-scoped">\n${extracted.scopedRules.join("\n\n")}\n</style>`;
          }
        }

        templateHtml = rawHtml.trim();
      }

      const shadowParts: string[] = [];
      if (globalCssBlock) shadowParts.push(globalCssBlock);
      if (siblingCssBlock) shadowParts.push(siblingCssBlock);
      if (scopedDsdCssBlock) shadowParts.push(scopedDsdCssBlock);
      if (templateHtml) shadowParts.push(templateHtml);

      const dsdContent = shadowParts.join("\n");
      const templateTag = `<template shadowrootmode="open">\n${dsdContent}\n</template>`;

      result = result.replace(elementRegex, (fullMatch, attrs, selfClose, offset, fullString) => {
        const isSelfClosing = selfClose && selfClose.trim() === "/";
        const attrStr = attrs ? ` ${attrs.trim()}` : "";

        const remainder = fullString.slice(offset + fullMatch.length).trimStart();
        if (remainder.startsWith("<template") && remainder.includes("shadowrootmode=")) {
          return fullMatch;
        }

        modified = true;
        return isSelfClosing
          ? `<${tag}${attrStr}>\n${templateTag}\n</${tag}>`
          : `<${tag}${attrStr}>\n${templateTag}`;
      });
    }

    if (!modified) {
      break;
    }
  }

  if (scriptsToInject.length > 0) {
    result = injectIntoHead(result, `  ${scriptsToInject.join("\n  ")}`, "append");
  }

  return result;
}
