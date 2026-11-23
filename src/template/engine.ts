import { existsSync } from "node:fs";
import { extname, relative } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { parseHtmlAttributes, replaceLiteral } from "../utils/html.ts";
import { logWarn } from "../utils/logger.ts";
import { CssDependencyGraph } from "./css-graph.ts";
import { resolvePageCss } from "./css-resolver.ts";
import { loadGlobalData, type TemplateContext } from "./data-loader.ts";
import { interpolateTemplate, getNestedValue, resolveConditionals } from "./directives.ts";
import { hasScriptWithSrc, resolveWebComponentsInHtml } from "./dsd-renderer.ts";
import { ScopeRegistry } from "./scoped-css.ts";
import { attachSiblingCssIfPresent, renderSvgComponent } from "./svg-component.ts";
import { VirtualFileSystem } from "./vfs.ts";
import { filenameToTagName } from "./web-components.ts";

export { hasScriptWithSrc };

export class TemplateEngine {
  private config: ResolvedConfig;
  public vfs: VirtualFileSystem;
  public scopeRegistry: ScopeRegistry;
  public cssGraph: CssDependencyGraph;
  public generatedPageStyles: Map<string, string> = new Map();
  private cachedData: TemplateContext | null = null;
  private warnedUnknownTags: Set<string> = new Set();

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.vfs = new VirtualFileSystem(this.config.root);
    this.scopeRegistry = new ScopeRegistry();
    this.cssGraph = new CssDependencyGraph(this.config.root);
  }

  public async loadData(): Promise<TemplateContext> {
    if (this.cachedData) return this.cachedData;
    this.cachedData = await loadGlobalData(this.config, this.vfs);
    return this.cachedData;
  }

  public invalidateDataCache(): void {
    this.cachedData = null;
  }

  public invalidateCache(filePath?: string): void {
    this.cachedData = null;
    this.vfs.invalidateFile(filePath);
    this.scopeRegistry.clear();
    this.cssGraph.invalidate();
    this.generatedPageStyles.clear();
    this.warnedUnknownTags.clear();
  }

  public async renderPage(
    pageHtml: string,
    currentFile = "",
    pageContext?: { params?: Record<string, string>; props?: Record<string, unknown> } | TemplateContext
  ): Promise<string> {
    const data = await this.loadData();
    const context: TemplateContext = { ...data };

    if (pageContext) {
      if (pageContext.params !== undefined) context.params = pageContext.params;
      if (pageContext.props !== undefined) context.props = pageContext.props;
      for (const [k, v] of Object.entries(pageContext)) {
        if (k !== "params" && k !== "props" && k !== "env") {
          context[k] = v;
        }
      }
    }

    await this.cssGraph.analyze(this.vfs);
    const globalRoot = this.cssGraph.getGlobalRoot();
    if (globalRoot.conflicts.length > 1) {
      const relConflicts = globalRoot.conflicts.map((c) => relative(this.config.root, c));
      logWarn(
        `Multiple orphan global CSS roots detected: ${relConflicts.map((c) => `"${c}"`).join(", ")}. Please link them via @import in a single root file or co-locate them with a component/page.`,
        "Bustatic Conflict Warning"
      );
    }

    let processedHtml = pageHtml;
    if (currentFile && currentFile.endsWith(".html")) {
      processedHtml = await attachSiblingCssIfPresent({
        templateHtml: processedHtml,
        templatePath: currentFile,
        siblingCssPath: currentFile.replace(/\.html$/, ".css"),
        kindLabel: "Page",
        config: this.config,
        vfs: this.vfs,
        cssGraph: this.cssGraph,
      });
    }

    let composed = await this.resolveLayout(processedHtml, context, currentFile);
    composed = await this.resolveEach(composed, context, currentFile);
    composed = await this.resolveComponents(composed, context, currentFile);
    composed = this.resolveConditionals(composed, context);
    composed = this.interpolate(composed, context);
    composed = await this.resolveWebComponents(composed, context);
    composed = await this.resolveCss(composed, currentFile);

    return composed;
  }

  public async resolveCss(
    html: string,
    currentFile = "",
    extraScopedRules: string[] = []
  ): Promise<string> {
    return resolvePageCss({
      html,
      currentFile,
      extraScopedRules,
      config: this.config,
      vfs: this.vfs,
      cssGraph: this.cssGraph,
      scopeRegistry: this.scopeRegistry,
      generatedPageStyles: this.generatedPageStyles,
    });
  }

  public async resolveWebComponents(
    html: string,
    context: TemplateContext = {}
  ): Promise<string> {
    return resolveWebComponentsInHtml({
      html,
      context,
      config: this.config,
      vfs: this.vfs,
      cssGraph: this.cssGraph,
      scopeRegistry: this.scopeRegistry,
      warnedUnknownTags: this.warnedUnknownTags,
      resolveComponentsFn: (raw, ctx, file) => this.resolveComponents(raw, ctx, file),
    });
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

  public resolveFilePath(rawSrc: string, currentFile: string, defaultDir: string): string {
    return this.vfs.resolvePath(rawSrc, currentFile, defaultDir);
  }

  private async resolveLayout(html: string, context: TemplateContext, currentFile: string): Promise<string> {
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

    const layoutTemplate = await this.vfs.readText(layoutFilePath);

    let resolvedInner = await this.resolveEach(innerContent, context, currentFile);
    resolvedInner = await this.resolveComponents(resolvedInner, context, currentFile);

    const layoutSlotNames = new Set<string>();
    const layoutSlotRegex = /<slot\s+name=["']([^"']+)["']/gi;
    let sm: RegExpExecArray | null;
    while ((sm = layoutSlotRegex.exec(layoutTemplate)) !== null) {
      layoutSlotNames.add(sm[1]);
    }

    const slots = new Map<string, string>();
    const slotElRegex = /<([a-zA-Z0-9_-]+)\s+[^>]*slot=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
    const defaultContent = resolvedInner
      .replace(slotElRegex, (match, _tag, slotName, content, offset) => {
        if (layoutSlotNames.has(slotName) && !slots.has(slotName)) {
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
      })
      .trim();

    let rendered = layoutTemplate.replace(
      /<slot\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/slot>/gi,
      (_match, name, fallback) => slots.get(name) ?? fallback
    );
    rendered = rendered.replace(
      /<slot\s+name=["']([^"']+)["']\s*\/>/gi,
      (_match, name) => slots.get(name) ?? ""
    );

    rendered = rendered.replace(/<slot\s*>\s*<\/slot>/gi, () => defaultContent);
    rendered = rendered.replace(/<slot\s*\/>/gi, () => defaultContent);

    rendered = await this.resolveEach(rendered, context, layoutFilePath);
    rendered = await this.resolveComponents(rendered, context, layoutFilePath);

    return rendered;
  }

  public async resolveEach(
    html: string,
    context: TemplateContext,
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
      const attrs = parseHtmlAttributes(item.attrString);
      let items: unknown;

      if (attrs.src) {
        const filePath = this.resolveFilePath(attrs.src, currentFile, this.config.dataDir);
        if (!this.vfs.hasFile(filePath) && !existsSync(filePath)) {
          throw new Error(`[Bustatic] <each> data file not found: "${attrs.src}" at ${filePath}`);
        }
        items = await this.vfs.readJson(filePath);
      } else if (attrs.in) {
        items = getNestedValue(context, attrs.in);
      } else {
        throw new Error(`[Bustatic] <each> tag requires either a "src" or "in" attribute.`);
      }

      if (!Array.isArray(items)) {
        throw new Error(`[Bustatic] <each> source "${attrs.src || attrs.in}" did not resolve to an array.`);
      }

      const renderedItems: string[] = [];
      for (const entry of items) {
        let itemContext: TemplateContext = { ...context };

        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          itemContext = { ...itemContext, ...(entry as Record<string, unknown>) };
          if (attrs.as) {
            itemContext[attrs.as] = entry;
          }
        } else {
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

      result = replaceLiteral(result, item.fullMatch, renderedItems.join("\n"));
    }

    return result;
  }

  public async resolveComponents(
    html: string,
    context: TemplateContext,
    currentFile: string,
    depth = 0
  ): Promise<string> {
    if (depth > 10) {
      console.warn("[Bustatic] Maximum component recursion depth (10) reached. Check for circular component includes.");
      return html;
    }

    const componentRegex = /<component\s+([^>]+?)(?:\s*\/>|>(.*?)<\/component>)/gis;
    const matches: Array<{
      fullMatch: string;
      children: string;
      src: string;
      props: Record<string, string>;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(html)) !== null) {
      const props = parseHtmlAttributes(match[1]);
      if (props.src) {
        matches.push({
          fullMatch: match[0],
          children: match[2] ? match[2].trim() : "",
          src: props.src,
          props,
        });
      }
    }

    if (matches.length === 0) return html;

    let result = html;
    for (const item of matches) {
      const compPath = this.resolveFilePath(item.src, currentFile, this.config.componentsDir);
      if (!this.vfs.hasFile(compPath) && !existsSync(compPath)) {
        throw new Error(`[Bustatic] Component not found: "${item.src}" at ${compPath}`);
      }

      const ext = extname(compPath).toLowerCase();
      if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") {
        const replacement = await this.renderWebComponentAlias({
          compPath,
          rawSrc: item.src,
          props: item.props,
          children: item.children,
          context,
          currentFile,
          depth,
        });
        result = replaceLiteral(result, item.fullMatch, replacement);
        continue;
      }

      if (ext === ".svg") {
        const svgContent = await renderSvgComponent({
          compPath,
          props: item.props,
          config: this.config,
          vfs: this.vfs,
          cssGraph: this.cssGraph,
        });
        result = replaceLiteral(result, item.fullMatch, svgContent);
        continue;
      }

      let compTemplate = await this.vfs.readText(compPath);
      compTemplate = await attachSiblingCssIfPresent({
        templateHtml: compTemplate,
        templatePath: compPath,
        siblingCssPath: compPath.replace(/\.html$/, ".css"),
        kindLabel: "Component",
        config: this.config,
        vfs: this.vfs,
        cssGraph: this.cssGraph,
      });

      const compContext = { ...context, ...item.props };
      compTemplate = compTemplate.replace(/<slot\s*>\s*<\/slot>/gi, () => item.children);
      compTemplate = compTemplate.replace(/<slot\s*\/>/gi, () => item.children);
      compTemplate = this.resolveConditionals(compTemplate, compContext);
      compTemplate = this.interpolate(compTemplate, compContext);
      compTemplate = await this.resolveComponents(compTemplate, compContext, compPath, depth + 1);

      result = replaceLiteral(result, item.fullMatch, compTemplate);
    }

    return result;
  }

  private async renderWebComponentAlias(options: {
    compPath: string;
    rawSrc: string;
    props: Record<string, string>;
    children: string;
    context: TemplateContext;
    currentFile: string;
    depth: number;
  }): Promise<string> {
    const { compPath, rawSrc, props, children, context, currentFile, depth } = options;

    let tag: string | undefined = this.vfs.registry.getTagsForFile(compPath)[0];
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
        `[Bustatic] Could not determine Custom Element tag name for Web Component file "${rawSrc}". ` +
          `Ensure the filename follows kebab-case (e.g. "my-element.ts") or PascalCase (e.g. "MyElement.ts").`
      );
    }

    const attrEntries = Object.entries(props).filter(([k]) => k !== "src");
    const attrString =
      attrEntries.length > 0
        ? " " + attrEntries.map(([k, v]) => `${k}="${v}"`).join(" ")
        : "";

    let innerChildren = children;
    if (innerChildren) {
      innerChildren = await this.resolveComponents(innerChildren, context, currentFile, depth + 1);
      innerChildren = this.resolveConditionals(innerChildren, context);
      innerChildren = this.interpolate(innerChildren, context);
    }

    return innerChildren
      ? `<${tag}${attrString}>${innerChildren}</${tag}>`
      : `<${tag}${attrString}></${tag}>`;
  }

  public resolveConditionals(html: string, context: TemplateContext): string {
    return resolveConditionals(html, context);
  }

  public interpolate(html: string, context: TemplateContext): string {
    return interpolateTemplate(html, context);
  }
}
