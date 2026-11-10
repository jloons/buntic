import { join, resolve, dirname, relative, basename, extname } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";
import { VirtualFileSystem } from "./vfs.ts";
import {
  ScopeRegistry,
  extractScopedStyles,
  attachSiblingScopedCss,
  transformScopedCss,
} from "./scoped-css.ts";
import { scriptImportsCssFile, findTriadForScript, filenameToTagName, RESERVED_W3C_TAGS } from "./web-components.ts";
import { CssDependencyGraph } from "./css-graph.ts";
import { loadPublicEnv, isReservedNamespace } from "../env.ts";

/**
 * Checks whether an HTML string already contains a <script> tag pointing to srcPath.
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

export class TemplateEngine {
  private config: ResolvedConfig;
  public vfs: VirtualFileSystem;
  public scopeRegistry: ScopeRegistry;
  public cssGraph: CssDependencyGraph;
  public generatedPageStyles: Map<string, string> = new Map();
  private cachedData: Record<string, any> | null = null;
  private warnedUnknownTags: Set<string> = new Set();

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.vfs = new VirtualFileSystem(this.config.root);
    this.scopeRegistry = new ScopeRegistry();
    this.cssGraph = new CssDependencyGraph(this.config.root);
  }

  /**
   * Loads all JSON and TS/JS data files in the data directory into an in-memory key-value map,
   * along with public environment variables under the "env" namespace.
   * e.g. data/site.json -> { site: { ... } }, data/articles.ts -> { articles: [ ... ] }
   */
  public async loadData(): Promise<Record<string, any>> {
    if (this.cachedData) return this.cachedData;

    const data: Record<string, any> = {};
    const publicEnv = loadPublicEnv(this.config.root);
    data["env"] = publicEnv;

    if (!existsSync(this.config.dataDir)) {
      this.cachedData = data;
      return data;
    }

    try {
      const entries = readdirSync(this.config.dataDir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;

        let key = "";
        let isModule = false;
        let isJson = false;

        if (entry.endsWith(".json")) {
          key = entry.replace(/\.json$/, "");
          isJson = true;
        } else if (
          (entry.endsWith(".ts") || entry.endsWith(".js") || entry.endsWith(".mjs")) &&
          !entry.endsWith(".d.ts")
        ) {
          key = entry.replace(/\.(ts|js|mjs)$/, "");
          isModule = true;
        }

        if (!key) continue;

        if (isReservedNamespace(key)) {
          console.warn(
            `\x1b[33m⚠ [Bustatic Warning]\x1b[0m File "${entry}" in data/ conflicts with reserved namespace "${key}". File skipped.`
          );
          continue;
        }

        const fullPath = join(this.config.dataDir, entry);

        if (isJson) {
          try {
            data[key] = await this.vfs.readJson(fullPath);
          } catch {
            data[key] = await Bun.file(fullPath).json();
          }
        } else if (isModule) {
          try {
            const mod = await import(fullPath);
            const loader = mod.default ?? mod.load ?? mod.getData;
            if (typeof loader === "function") {
              data[key] = await loader({ env: publicEnv });
            } else if (loader !== undefined) {
              data[key] = loader;
            } else {
              data[key] = mod;
            }
          } catch (err: any) {
            console.error(
              `\x1b[31m[Bustatic Error]\x1b[0m Failed to execute global data loader "${entry}":`,
              err?.message || err
            );
            throw err;
          }
        }
      }
    } catch (err: any) {
      if (err && err.message?.includes("[Bustatic Error]")) {
        throw err;
      }
      // Ignored if data directory cannot be read
    }

    this.cachedData = data;
    return data;
  }

  public invalidateDataCache(): void {
    this.cachedData = null;
  }

  /**
   * Invalidate VFS cache, data cache, scope registry and page styles.
   */
  public invalidateCache(filePath?: string): void {
    this.cachedData = null;
    this.vfs.invalidateFile(filePath);
    this.scopeRegistry.clear();
    this.cssGraph.invalidate();
    this.generatedPageStyles.clear();
    this.warnedUnknownTags.clear();
  }

  /**
   * Main entry point: renders a page HTML string by:
   * 1. Resolving <layout> and <slot>
   * 2. Resolving <each> blocks
   * 3. Resolving <component> tags recursively
   * 4. Resolving conditionals (if attribute and <if> block)
   * 5. Interpolating data variables (with ?? fallback support)
   * 6. Auto-inject Web Component scripts
   * 7. Resolving Scoped CSS and stylesheets according to cssStrategy
   */
  public async renderPage(
    pageHtml: string,
    currentFile = "",
    pageContext?: { params?: Record<string, string>; props?: Record<string, any> } | Record<string, any>
  ): Promise<string> {
    const data = await this.loadData();
    const context: Record<string, any> = { ...data };

    if (pageContext) {
      if (pageContext.params !== undefined) context.params = pageContext.params;
      if (pageContext.props !== undefined) context.props = pageContext.props;
      for (const [k, v] of Object.entries(pageContext)) {
        if (k !== "params" && k !== "props" && k !== "env") {
          context[k] = v;
        }
      }
    }

    // Analyze CSS dependency graph for global root and components
    await this.cssGraph.analyze(this.vfs);
    const globalRoot = this.cssGraph.getGlobalRoot();
    if (globalRoot.conflicts.length > 1) {
      const relConflicts = globalRoot.conflicts.map((c) => relative(this.config.root, c));
      console.warn(
        `\x1b[33m⚠ [Bustatic Conflict Warning]\x1b[0m Multiple orphan global CSS roots detected: ${relConflicts.map((c) => `"${c}"`).join(", ")}. Please link them via @import in a single root file or co-locate them with a component/page.`
      );
    }

    // Check for co-located sibling CSS for the page itself if it has a single root element
    let processedHtml = pageHtml;
    if (currentFile && currentFile.endsWith(".html")) {
      const siblingCssPath = currentFile.replace(/\.html$/, ".css");
      if (this.vfs.hasFile(siblingCssPath)) {
        let siblingCss = "";
        try {
          siblingCss = await this.cssGraph.flattenCss(siblingCssPath, this.vfs);
        } catch {
          siblingCss = await Bun.file(siblingCssPath).text();
        }

        if (siblingCss.trim().length > 0) {
          const withScopedCss = attachSiblingScopedCss(processedHtml, siblingCss);
          if (withScopedCss !== null) {
            processedHtml = withScopedCss;
          } else {
            const relPage = relative(this.config.root, currentFile);
            const relCss = relative(this.config.root, siblingCssPath);
            console.warn(
              `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Page "${relPage}" has a sibling CSS file ("${relCss}"), but does not have a single root element. Scoped styles were not applied.`
            );
          }
        }
      }
    }

    // 1. Resolve Layout (if page specifies <layout src="...">)
    let composed = await this.resolveLayout(processedHtml, context, currentFile);

    // 2. Resolve <each> blocks
    composed = await this.resolveEach(composed, context, currentFile);

    // 3. Resolve any remaining components
    composed = await this.resolveComponents(composed, context, currentFile);

    // 4. Resolve Conditionals
    composed = this.resolveConditionals(composed, context);

    // 5. Interpolate data variables
    composed = this.interpolate(composed, context);

    // 6. Auto-inject Web Components with Declarative Shadow DOM
    composed = await this.resolveWebComponents(composed, context);

    // 7. Resolve Scoped CSS & Stylesheets
    composed = await this.resolveCss(composed, currentFile);

    return composed;
  }

  /**
   * Processes scoped styles (<style scoped>) and manages CSS injection based on config.cssStrategy:
   * - "inline": inlines global stylesheets and scoped styles directly into <head> (default).
   * - "external": leaves global stylesheets as <link> and links page-specific scoped CSS as <link>.
   */
  public async resolveCss(
    html: string,
    currentFile = "",
    extraScopedRules: string[] = []
  ): Promise<string> {
    // 1. Extract scoped styles from HTML
    const { html: cleanHtml, scopedRules } = extractScopedStyles(html, this.scopeRegistry);
    let result = cleanHtml;

    const allScopedRules = [...scopedRules, ...extraScopedRules];
    const hasScopedRules = allScopedRules.length > 0;
    const scopedCssText = hasScopedRules ? allScopedRules.join("\n\n") : "";

    const globalRoot = this.cssGraph.getGlobalRoot();
    let globalCssContent: string | null = null;
    if (globalRoot.root) {
      globalCssContent = await this.cssGraph.flattenCss(globalRoot.root, this.vfs);
    }

    if (this.config.cssStrategy === "inline") {
      // Inline global stylesheets from local <link rel="stylesheet" href="...">
      const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi;
      const links = Array.from(result.matchAll(linkRegex));
      let hadManualGlobalLink = false;

      for (const m of links) {
        const fullTag = m[0];
        const hrefMatch = fullTag.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;

        const href = hrefMatch[1];
        // Skip external or protocol-relative URLs
        if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
          continue;
        }

        let cssFilePath = "";
        if (href.startsWith("/")) {
          const direct = join(this.config.root, href.slice(1));
          const inSrc = join(this.config.root, "src", href.slice(1));
          if (this.vfs.hasFile(direct) || existsSync(direct)) {
            cssFilePath = direct;
          } else if (this.vfs.hasFile(inSrc) || existsSync(inSrc)) {
            cssFilePath = inSrc;
          } else {
            cssFilePath = direct;
          }
        } else {
          const fromDir = currentFile ? dirname(currentFile) : this.config.pagesDir;
          cssFilePath = resolve(fromDir, href);
        }

        if (this.vfs.hasFile(cssFilePath) || existsSync(cssFilePath)) {
          let cssContent = "";
          try {
            cssContent = await this.cssGraph.flattenCss(cssFilePath, this.vfs);
          } catch {
            cssContent = await Bun.file(cssFilePath).text();
          }

          const styleBlock = `<style id="__bustatic_global">\n${cssContent}\n</style>`;
          result = result.replace(fullTag, styleBlock);
          hadManualGlobalLink = true;
        }
      }

      // If global root exists and was not inlined via manual <link>, auto-inject it!
      const headMatch = result.match(/<head[\s\S]*?<\/head>/i);
      const headHasGlobalStyle = headMatch ? headMatch[0].includes('id="__bustatic_global"') : false;
      if (!hadManualGlobalLink && !headHasGlobalStyle && globalCssContent) {
        const globalTag = `<style id="__bustatic_global">\n${globalCssContent}\n</style>`;
        if (result.includes("</head>")) {
          result = result.replace("</head>", `  ${globalTag}\n</head>`);
        } else if (result.includes("</body>")) {
          result = result.replace("</body>", `  ${globalTag}\n</body>`);
        } else {
          result = `${globalTag}\n${result}`;
        }
      }

      // Inline scoped styles directly after global styles or in <head>
      if (hasScopedRules) {
        const scopedTag = `<style id="__bustatic_scoped">\n${scopedCssText}\n</style>`;
        if (result.includes("</head>")) {
          result = result.replace("</head>", `  ${scopedTag}\n</head>`);
        } else if (result.includes("</body>")) {
          result = result.replace("</body>", `  ${scopedTag}\n</body>`);
        } else {
          result = `${result}\n${scopedTag}`;
        }
      }
    } else {
      // "external" mode:
      // Auto-inject global stylesheet link if not already present
      if (globalRoot.relativeRoot) {
        const globalPublicHref = `/${globalRoot.relativeRoot.replace(/\\/g, "/")}`;
        const withoutSrc = globalPublicHref.startsWith("/src/")
          ? globalPublicHref.slice(4)
          : globalPublicHref;
        if (!result.includes(globalPublicHref) && !result.includes(withoutSrc)) {
          const globalLink = `<link rel="stylesheet" href="${globalPublicHref}">`;
          if (result.includes("</head>")) {
            result = result.replace("</head>", `  ${globalLink}\n</head>`);
          } else if (result.includes("</body>")) {
            result = result.replace("</body>", `  ${globalLink}\n</body>`);
          } else {
            result = `${globalLink}\n${result}`;
          }
        }
      }

      // Link page-specific scoped CSS if any rules exist
      if (hasScopedRules) {
        let pageRelPath = currentFile ? relative(this.config.pagesDir, currentFile) : "page.html";
        if (pageRelPath.startsWith("..") || !currentFile) {
          pageRelPath = "index.html";
        }
        const scopedCssRel = pageRelPath.replace(/\.html$/, ".scoped.css");
        const scopedPublicPath = "/" + scopedCssRel.replace(/\\/g, "/");

        // Save in memory for dev server / builder
        this.generatedPageStyles.set(scopedPublicPath, scopedCssText);
        this.generatedPageStyles.set(scopedCssRel, scopedCssText);

        const linkTag = `<link rel="stylesheet" href="${scopedPublicPath}">`;
        if (result.includes("</head>")) {
          result = result.replace("</head>", `  ${linkTag}\n</head>`);
        } else if (result.includes("</body>")) {
          result = result.replace("</body>", `  ${linkTag}\n</body>`);
        } else {
          result = `${result}\n${linkTag}`;
        }
      }
    }

    return result;
  }

  /**
   * Automatically scans HTML for declared Custom Element tags (e.g. <counter-button>),
   * injects Declarative Shadow DOM (<template shadowrootmode="open">) if triad files exist,
   * and injects the corresponding <script type="module" src="..."> into <head>.
   */
  public async resolveWebComponents(
    html: string,
    context: Record<string, any> = {}
  ): Promise<string> {
    const scriptsToInject: string[] = [];
    const injectedPaths = new Set<string>();

    let result = html;
    const globalRoot = this.cssGraph.getGlobalRoot();
    let globalCssBlock = "";
    if (globalRoot.root) {
      if (this.config.cssStrategy === "inline") {
        const globalCss = await this.cssGraph.flattenCss(globalRoot.root, this.vfs);
        globalCssBlock = `<style data-bustatic="global">\n${globalCss.trim()}\n</style>`;
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
        const scriptPath = this.vfs.registry.findScriptForTag(tag);
        if (!scriptPath) {
          if (!RESERVED_W3C_TAGS.has(tag) && !this.warnedUnknownTags.has(tag)) {
            this.warnedUnknownTags.add(tag);
            console.warn(
              `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Custom Element "<${tag}>" was found in HTML, but no matching Web Component file was found in the project.`
            );
          }
          continue;
        }

        this.vfs.registry.markTagUsed(tag);
        const rel = relative(this.config.root, scriptPath).replace(/\\/g, "/");
        const publicSrc = rel.startsWith("/") ? rel : `/${rel}`;

        if (!injectedPaths.has(publicSrc) && !hasScriptWithSrc(result, publicSrc)) {
          injectedPaths.add(publicSrc);
          scriptsToInject.push(`<script type="module" src="${publicSrc}"></script>`);
        }

        // Check for component triad (.html, .css)
        const triad = findTriadForScript(scriptPath, (p) => this.vfs.hasFile(p));
        if (!triad) continue;

        // Only construct Declarative Shadow DOM if .html or .css exists
        if (!triad.htmlPath && !triad.cssPath) continue;

        // Check if there are instances of <tag> that don't have <template shadowrootmode="open"> yet
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
            siblingCss = await this.cssGraph.flattenCss(triad.cssPath, this.vfs);
          } catch {
            siblingCss = await Bun.file(triad.cssPath).text();
          }

          // Replace & with :host for Shadow DOM native styling
          siblingCss = siblingCss.replace(/(^|[^a-zA-Z0-9_-])&(?![\w-])/g, "$1:host");
          if (siblingCss.trim().length > 0) {
            siblingCssBlock = `<style>\n${siblingCss.trim()}\n</style>`;
          }
        }

        let templateHtml = "<slot></slot>";
        if (triad.htmlPath) {
          let rawHtml = "";
          try {
            rawHtml = await this.vfs.readText(triad.htmlPath);
          } catch {
            rawHtml = await Bun.file(triad.htmlPath).text();
          }
          rawHtml = await this.resolveComponents(rawHtml, context, triad.htmlPath);
          rawHtml = this.resolveConditionals(rawHtml, context);
          rawHtml = this.interpolate(rawHtml, context);
          templateHtml = rawHtml.trim();
        }

        const shadowParts: string[] = [];
        if (globalCssBlock) shadowParts.push(globalCssBlock);
        if (siblingCssBlock) shadowParts.push(siblingCssBlock);
        if (templateHtml) shadowParts.push(templateHtml);

        const dsdContent = shadowParts.join("\n");
        const templateTag = `<template shadowrootmode="open">\n${dsdContent}\n</template>`;

        // Inject <template shadowrootmode="open"> into each unexpanded instance of <tag ...> in result
        result = result.replace(elementRegex, (fullMatch, attrs, selfClose, offset, fullString) => {
          const isSelfClosing = selfClose && selfClose.trim() === "/";
          const attrStr = attrs ? ` ${attrs.trim()}` : "";

          // Check if immediately followed by <template shadowrootmode
          const remainder = fullString.slice(offset + fullMatch.length).trimStart();
          if (remainder.startsWith("<template") && remainder.includes("shadowrootmode=")) {
            return fullMatch;
          }

          modified = true;
          if (isSelfClosing) {
            return `<${tag}${attrStr}>\n${templateTag}\n</${tag}>`;
          } else {
            return `<${tag}${attrStr}>\n${templateTag}`;
          }
        });
      }

      if (!modified) {
        break;
      }
    }

    if (scriptsToInject.length > 0) {
      const scriptTags = scriptsToInject.join("\n  ");
      if (result.includes("</head>")) {
        result = result.replace("</head>", `  ${scriptTags}\n</head>`);
      } else if (result.includes("</body>")) {
        result = result.replace("</body>", `  ${scriptTags}\n</body>`);
      } else {
        result = `${result}\n${scriptTags}`;
      }
    }

    return result;
  }

  /**
   * Automatically scans HTML for declared Custom Element tags (e.g. <counter-button>)
   * and injects the corresponding <script type="module" src="..."> into <head>.
   */
  public injectWebComponents(html: string): string {
    const scriptsToInject: string[] = [];
    const injectedPaths = new Set<string>();

    const tagRegex = /<([a-z][a-z0-9]*-[a-z0-9-]*)/gi;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      const scriptPath = this.vfs.registry.findScriptForTag(tag);
      if (scriptPath) {
        this.vfs.registry.markTagUsed(tag);
        const rel = relative(this.config.root, scriptPath).replace(/\\/g, "/");
        const publicSrc = rel.startsWith("/") ? rel : `/${rel}`;

        // Don't inject if already injected or already referenced in the HTML document
        if (!injectedPaths.has(publicSrc) && !hasScriptWithSrc(html, publicSrc)) {
          injectedPaths.add(publicSrc);
          scriptsToInject.push(`<script type="module" src="${publicSrc}"></script>`);
        }
      }
    }

    if (scriptsToInject.length === 0) {
      return html;
    }

    const scriptTags = scriptsToInject.join("\n  ");
    if (html.includes("</head>")) {
      return html.replace("</head>", `  ${scriptTags}\n</head>`);
    } else if (html.includes("</body>")) {
      return html.replace("</body>", `  ${scriptTags}\n</body>`);
    } else {
      return `${html}\n${scriptTags}`;
    }
  }

  public getUnusedWebComponents(): Array<{ tag: string; file: string }> {
    return this.vfs.registry.getUnusedComponents();
  }

  public assertNoWebComponentConflicts(): void {
    this.vfs.registry.assertNoConflicts();
  }

  public clearUsedWebComponents(): void {
    this.vfs.registry.clearUsed();
  }

  /**
   * Resolves a file path referenced in a template using the Virtual File System.
   */
  public resolveFilePath(rawSrc: string, currentFile: string, defaultDir: string): string {
    return this.vfs.resolvePath(rawSrc, currentFile, defaultDir);
  }

  /**
   * Resolves <layout src="..."> wrapping the page.
   * Extracts named slots and default slot content from the page,
   * loads the layout file, and injects the contents into layout's <slot> tags.
   */
  private async resolveLayout(html: string, context: Record<string, any>, currentFile: string): Promise<string> {
    const layoutMatch = html.match(/<layout\s+src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/layout>/i);
    if (!layoutMatch) {
      return html;
    }

    const layoutRawSrc = layoutMatch[1];
    const innerContent = layoutMatch[2];

    const layoutFilePath = this.resolveFilePath(layoutRawSrc, currentFile, this.config.layoutsDir);
    if (!this.vfs.hasFile(layoutFilePath) && !existsSync(layoutFilePath)) {
      throw new Error(`[Bustatic] Layout not found: "${layoutRawSrc}" at ${layoutFilePath}`);
    }

    let layoutTemplate = await this.vfs.readText(layoutFilePath);

    // Process <each> inside page inner content using the page's currentFile path
    let resolvedInner = await this.resolveEach(innerContent, context, currentFile);

    // Process components inside page inner content using the page's currentFile path
    resolvedInner = await this.resolveComponents(resolvedInner, context, currentFile);

    // Find all slot names declared by this layout
    const layoutSlotNames = new Set<string>();
    const layoutSlotRegex = /<slot\s+name=["']([^"']+)["']/gi;
    let sm: RegExpExecArray | null;
    while ((sm = layoutSlotRegex.exec(layoutTemplate)) !== null) {
      layoutSlotNames.add(sm[1]);
    }

    // Extract named slots and default content
    const slots = new Map<string, string>();
    const slotElRegex = /<([a-zA-Z0-9_-]+)\s+[^>]*slot=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
    const defaultContent = resolvedInner.replace(slotElRegex, (match, _tag, slotName, content, offset) => {
      if (layoutSlotNames.has(slotName) && !slots.has(slotName)) {
        // Ensure this slot element is not nested inside an open Web Component
        const preceding = resolvedInner.slice(0, offset);
        const openCustomTags = preceding.match(/<([a-z][a-z0-9]*-[a-z0-9-]*)[^>]*>/gi) || [];
        const closeCustomTags = preceding.match(/<\/([a-z][a-z0-9]*-[a-z0-9-]*)[^>]*>/gi) || [];
        if (openCustomTags.length > closeCustomTags.length) {
          return match;
        }

        slots.set(slotName, content.trim());
        return "";
      }
      return match;
    }).trim();

    // Replace named slots in the layout: <slot name="slotName">fallback</slot> or <slot name="slotName" />
    let rendered = layoutTemplate.replace(
      /<slot\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/slot>/gi,
      (_match, name, fallback) => slots.get(name) ?? fallback
    );
    rendered = rendered.replace(
      /<slot\s+name=["']([^"']+)["']\s*\/>/gi,
      (_match, name) => slots.get(name) ?? ""
    );

    // Replace default slot: <slot></slot> or <slot />
    rendered = rendered.replace(/<slot\s*>\s*<\/slot>/gi, defaultContent);
    rendered = rendered.replace(/<slot\s*\/>/gi, defaultContent);

    // Process <each> in layout
    rendered = await this.resolveEach(rendered, context, layoutFilePath);

    // Process components that originated in the layout file, using layoutFilePath as reference
    rendered = await this.resolveComponents(rendered, context, layoutFilePath);

    return rendered;
  }

  /**
   * Resolves <each src="..." in="..." [as="..."]>...</each> blocks.
   * Supports auto-spreading properties when items are objects.
   */
  public async resolveEach(
    html: string,
    context: Record<string, any>,
    currentFile: string,
    depth = 0
  ): Promise<string> {
    if (depth > 10) {
      console.warn("[Bustatic] Maximum <each> recursion depth (10) reached.");
      return html;
    }

    const eachRegex = /<each\s+([^>]+?)>([\s\S]*?)<\/each>/gis;
    let match: RegExpExecArray | null;
    const matches: Array<{ fullMatch: string; attrString: string; inner: string }> = [];

    while ((match = eachRegex.exec(html)) !== null) {
      matches.push({ fullMatch: match[0], attrString: match[1], inner: match[2] });
    }

    if (matches.length === 0) return html;

    let result = html;
    for (const item of matches) {
      const attrs = this.parseAttributes(item.attrString);
      let items: any[] = [];

      if (attrs.src) {
        const filePath = this.resolveFilePath(attrs.src, currentFile, this.config.dataDir);
        if (!this.vfs.hasFile(filePath) && !existsSync(filePath)) {
          throw new Error(`[Bustatic] <each> data file not found: "${attrs.src}" at ${filePath}`);
        }
        const fileContent = await this.vfs.readJson(filePath);
        items = fileContent;
      } else if (attrs.in) {
        items = this.getNestedValue(context, attrs.in);
      } else {
        throw new Error(`[Bustatic] <each> tag requires either a "src" or "in" attribute.`);
      }

      if (!Array.isArray(items)) {
        throw new Error(`[Bustatic] <each> source "${attrs.src || attrs.in}" did not resolve to an array.`);
      }

      const renderedItems: string[] = [];
      for (const entry of items) {
        let itemContext: Record<string, any> = { ...context };

        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          // Auto-spread object properties
          itemContext = { ...itemContext, ...entry };
          if (attrs.as) {
            itemContext[attrs.as] = entry;
          }
        } else {
          // Primitive item
          if (attrs.as) {
            itemContext[attrs.as] = entry;
          }
          itemContext.item = entry;
          itemContext.this = entry;
        }

        let rendered = await this.resolveEach(item.inner, itemContext, currentFile, depth + 1);
        rendered = await this.resolveComponents(rendered, itemContext, currentFile, depth + 1);
        rendered = this.resolveConditionals(rendered, itemContext);
        rendered = this.interpolate(rendered, itemContext);
        renderedItems.push(rendered);
      }

      result = result.replace(item.fullMatch, renderedItems.join("\n"));
    }

    return result;
  }

  /**
   * Resolves <component src="..." [props]> recursively.
   */
  public async resolveComponents(
    html: string,
    context: Record<string, any>,
    currentFile: string,
    depth = 0
  ): Promise<string> {
    if (depth > 10) {
      console.warn("[Bustatic] Maximum component recursion depth (10) reached. Check for circular component includes.");
      return html;
    }

    // Match both self-closing <component src="..." /> and with closing tag <component src="...">...</component>
    const componentRegex = /<component\s+([^>]+?)(?:\s*\/>|>(.*?)<\/component>)/gis;

    let hasMatch = false;
    const matches: Array<{
      fullMatch: string;
      attrString: string;
      children: string;
      src: string;
      props: Record<string, string>;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(html)) !== null) {
      hasMatch = true;
      const fullMatch = match[0];
      const attrString = match[1];
      const children = match[2] ? match[2].trim() : "";

      const props = this.parseAttributes(attrString);
      const src = props.src;
      if (src) {
        matches.push({ fullMatch, attrString, children, src, props });
      }
    }

    if (!hasMatch) return html;

    let result = html;
    for (const item of matches) {
      const compPath = this.resolveFilePath(item.src, currentFile, this.config.componentsDir);

      if (!this.vfs.hasFile(compPath) && !existsSync(compPath)) {
        throw new Error(`[Bustatic] Component not found: "${item.src}" at ${compPath}`);
      }

      const ext = extname(compPath).toLowerCase();
      if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") {
        let tag = this.vfs.registry.getTagsForFile(compPath)[0];
        if (!tag) {
          let code: string | undefined;
          try {
            code = await this.vfs.readText(compPath);
          } catch {
            code = await Bun.file(compPath).text();
          }
          const registered = this.vfs.registry.registerFile(compPath, code);
          tag = registered[0];
        }
        if (!tag) {
          tag = filenameToTagName(compPath) || undefined;
        }

        if (!tag) {
          throw new Error(
            `[Bustatic] Could not determine Custom Element tag name for Web Component file "${item.src}". ` +
            `Ensure the filename follows kebab-case (e.g. "my-element.ts") or PascalCase (e.g. "MyElement.ts").`
          );
        }

        // Build HTML attributes from props (excluding "src")
        const attrEntries = Object.entries(item.props).filter(([k]) => k !== "src");
        const attrString = attrEntries.length > 0
          ? " " + attrEntries.map(([k, v]) => `${k}="${v}"`).join(" ")
          : "";

        // Resolve any nested components or expressions inside children
        let innerChildren = item.children;
        if (innerChildren) {
          innerChildren = await this.resolveComponents(innerChildren, context, currentFile, depth + 1);
          innerChildren = this.resolveConditionals(innerChildren, context);
          innerChildren = this.interpolate(innerChildren, context);
        }

        const replacement = innerChildren
          ? `<${tag}${attrString}>${innerChildren}</${tag}>`
          : `<${tag}${attrString}></${tag}>`;

        result = result.replace(item.fullMatch, replacement);
        continue;
      }

      let compTemplate = await this.vfs.readText(compPath);

      // Check for co-located sibling CSS file (e.g. footer.html + footer.css)
      const siblingCssPath = compPath.replace(/\.html$/, ".css");
      if (this.vfs.hasFile(siblingCssPath)) {
        let siblingCss = "";
        try {
          siblingCss = await this.cssGraph.flattenCss(siblingCssPath, this.vfs);
        } catch {
          siblingCss = await Bun.file(siblingCssPath).text();
        }

        if (siblingCss.trim().length > 0) {
          const withScopedCss = attachSiblingScopedCss(compTemplate, siblingCss);
          if (withScopedCss !== null) {
            compTemplate = withScopedCss;
          } else {
            const relComp = relative(this.config.root, compPath);
            const relCss = relative(this.config.root, siblingCssPath);
            console.warn(
              `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Component "${relComp}" has a sibling CSS file ("${relCss}"), but does not have a single root element. Scoped styles were not applied.`
            );
          }
        }
      }

      // Combined props with global / spread data
      const compContext = { ...context, ...item.props };

      // Replace component default slot if children provided
      compTemplate = compTemplate.replace(/<slot\s*>\s*<\/slot>/gi, item.children);
      compTemplate = compTemplate.replace(/<slot\s*\/>/gi, item.children);

      // Resolve conditionals inside component
      compTemplate = this.resolveConditionals(compTemplate, compContext);

      // Interpolate props inside the component
      compTemplate = this.interpolate(compTemplate, compContext);

      // Recurse to resolve any components that were inside this component file
      compTemplate = await this.resolveComponents(compTemplate, compContext, compPath, depth + 1);

      // Replace in parent
      result = result.replace(item.fullMatch, compTemplate);
    }

    return result;
  }

  /**
   * Resolves conditionals:
   * 1. <if is="expr"> ... [ <else> ... </else> ] </if>
   * 2. Self-closing elements: <tag ... if="expr" ... />
   * 3. Paired elements: <tag ... if="expr" ...>...</tag>
   */
  public resolveConditionals(html: string, context: Record<string, any>): string {
    // 1. <if is="expr"> ... [ <else> ... </else> ] </if>
    let res = html.replace(/<if\s+is=["']([^"']+)["'][^>]*>([\s\S]*?)<\/if>/gi, (_match, expr, inner) => {
      const val = this.getNestedValue(context, expr.trim());
      let thenContent = inner;
      let elseContent = "";
      const elseMatch = inner.match(/([\s\S]*?)<else>([\s\S]*?)<\/else>/i);
      if (elseMatch) {
        thenContent = elseMatch[1];
        elseContent = elseMatch[2];
      }
      return this.isTruthy(val) ? thenContent.trim() : elseContent.trim();
    });

    // 2. Self-closing: <tag ... if="expr" ... />
    res = res.replace(/<([a-zA-Z0-9_-]+)\s+([^>]*?)if=["']([^"']+)["']([^>]*?)\s*\/>/gi, (_m, tag, before, expr, after) => {
      const val = this.getNestedValue(context, expr.trim());
      if (!this.isTruthy(val)) return "";
      const attrs = `${before} ${after}`.trim().replace(/\s+/g, " ");
      return attrs ? `<${tag} ${attrs} />` : `<${tag} />`;
    });

    // 3. Paired tags: <tag ... if="expr" ...>...</tag>
    res = res.replace(/<([a-zA-Z0-9_-]+)\s+([^>]*?)if=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/\1>/gi, (_m, tag, before, expr, after, content) => {
      const val = this.getNestedValue(context, expr.trim());
      if (!this.isTruthy(val)) return "";
      const attrs = `${before} ${after}`.trim().replace(/\s+/g, " ");
      return attrs ? `<${tag} ${attrs}>${content}</${tag}>` : `<${tag}>${content}</${tag}>`;
    });

    return res;
  }

  private isTruthy(val: any): boolean {
    if (val === undefined || val === null || val === false || val === "") return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (typeof val === "number" && isNaN(val)) return false;
    return true;
  }

  private parseAttributes(attrString: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrString)) !== null) {
      const key = match[1];
      const val = match[2] !== undefined ? match[2] : "true";
      attrs[key] = val;
    }
    return attrs;
  }

  public interpolate(html: string, context: Record<string, any>): string {
    return html.replace(/\{\{\s*([a-zA-Z0-9_.-]+)(?:\s*\?\?\s*["']([^"']*)["'])?\s*\}\}/g, (match, key, fallback) => {
      const trimmed = key.trim();
      const val = this.getNestedValue(context, trimmed);
      if (val !== undefined && val !== null) return String(val);
      if (fallback !== undefined) return fallback;
      return match;
    });
  }

  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    const parts = path.split(".");
    let cur = obj;
    for (const part of parts) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  public getUnusedWebComponents(): Array<{ tag: string; file: string }> {
    return this.vfs.registry.getUnusedComponents();
  }
}
