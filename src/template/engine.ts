import { existsSync } from "node:fs";
import { extname, relative } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { parseHtmlAttributes, replaceLiteral } from "../utils/html.ts";
import { logWarn } from "../utils/logger.ts";
import { findTopLevelBlocks, splitDirectSubBlocks } from "./block-scanner.ts";
import { CssDependencyGraph } from "./css-graph.ts";
import { resolvePageCss } from "./css-resolver.ts";
import { loadGlobalData, type TemplateContext } from "./data-loader.ts";
import { interpolateTemplate, getNestedValue, resolveConditionals } from "./directives.ts";
import { hasScriptWithSrc, resolveWebComponentsInHtml } from "./dsd-renderer.ts";
import { BunticTemplateError, findSnippetLocation, formatTemplatePath } from "./errors.ts";
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
        "Buntic Conflict Warning"
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
    composed = this.resolveConditionals(composed, context, currentFile, pageHtml);
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

  private async getOriginalSource(filePath: string, fallbackHtml: string): Promise<string> {
    if (filePath && (this.vfs.hasFile(filePath) || existsSync(filePath))) {
      try {
        return await this.vfs.readText(filePath);
      } catch {
        return fallbackHtml;
      }
    }
    return fallbackHtml;
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
      const originalSource = await this.getOriginalSource(currentFile, html);
      const openTag = layoutMatch[0].slice(0, layoutMatch[0].indexOf(">") + 1);
      const location = findSnippetLocation({
        source: originalSource,
        snippet: layoutMatch[0],
        openTag,
        fallbackHtml: html,
        fallbackOffset: layoutMatch.index,
        filePath: currentFile || undefined,
      });
      const layoutsDirDisplay = formatTemplatePath(this.config.layoutsDir, this.config.root);
      throw new BunticTemplateError({
        message: `[Buntic] Layout not found: "${layoutRawSrc}" at ${layoutFilePath}`,
        location,
        projectRoot: this.config.root,
        resolvedTarget: layoutFilePath,
        hint: `Check that "${layoutRawSrc}" exists in "${layoutsDirDisplay}" or verify the relative path in <layout src="${layoutRawSrc}">.`,
      });
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
      console.warn("[Buntic] Maximum <each> recursion depth (10) reached.");
      return html;
    }

    const matches = findTopLevelBlocks(html, ["each"]);

    if (matches.length === 0) return html;

    const locateEachItem = async (item: (typeof matches)[number]) => {
      const originalSource = await this.getOriginalSource(currentFile, html);
      return findSnippetLocation({
        source: originalSource,
        snippet: item.fullMatch,
        openTag: item.openTag,
        fallbackHtml: html,
        fallbackOffset: item.start,
        filePath: currentFile || undefined,
      });
    };

    const originalSourceForFile =
      currentFile && (this.vfs.hasFile(currentFile) || existsSync(currentFile))
        ? await this.getOriginalSource(currentFile, html)
        : undefined;

    const renderFallbackBlock = async (content: string): Promise<string> => {
      const trimmed = content.trim();
      if (!trimmed) return "";
      let rendered = await this.resolveEach(trimmed, context, currentFile, depth + 1);
      rendered = await this.resolveComponents(rendered, context, currentFile, depth + 1);
      rendered = this.resolveConditionals(rendered, context, currentFile, originalSourceForFile);
      rendered = this.interpolate(rendered, context);
      return rendered;
    };

    let result = html;
    for (const item of matches) {
      const attrs = parseHtmlAttributes(item.attrString);
      const { body: loopTemplate, subBlocks } = splitDirectSubBlocks(
        item.inner,
        ["else", "none", "default"],
        ["each", "if", "unless", "match"]
      );

      let elseBlock: (typeof subBlocks)[number] | undefined;
      let noneBlock: (typeof subBlocks)[number] | undefined;
      let defaultBlock: (typeof subBlocks)[number] | undefined;
      for (const sub of subBlocks) {
        if (sub.tag === "else" && !elseBlock) elseBlock = sub;
        else if (sub.tag === "none" && !noneBlock) noneBlock = sub;
        else if (sub.tag === "default" && !defaultBlock) defaultBlock = sub;
      }

      let items: unknown;
      let resolvedFilePath: string | undefined;

      if (attrs.src) {
        const filePath = this.resolveFilePath(attrs.src, currentFile, this.config.dataDir);
        resolvedFilePath = filePath;

        if (!this.vfs.hasFile(filePath) && !existsSync(filePath)) {
          const location = await locateEachItem(item);
          const existsInContext = getNestedValue(context, attrs.src) !== undefined;
          const dataDirDisplay = formatTemplatePath(this.config.dataDir, this.config.root);
          let hint: string;
          if (existsInContext) {
            hint =
              `"${attrs.src}" is available in the template context. ` +
              `Use <each in="${attrs.src}"> to iterate context data, or provide a valid JSON file path (e.g. "${attrs.src}.json").`;
          } else if (!attrs.src.endsWith(".json")) {
            hint =
              `Use <each in="${attrs.src}"> to iterate data from context, ` +
              `or include the ".json" extension if loading a file from "${dataDirDisplay}" (e.g. <each src="${attrs.src}.json">).`;
          } else {
            hint = `Verify that "${attrs.src}" exists in "${dataDirDisplay}" or check the relative path.`;
          }

          throw new BunticTemplateError({
            message: `[Buntic] <each> data file not found: "${attrs.src}" at ${filePath}`,
            location,
            projectRoot: this.config.root,
            resolvedTarget: filePath,
            hint,
          });
        }

        try {
          items = await this.vfs.readJson(filePath);
        } catch (err: unknown) {
          const location = await locateEachItem(item);
          const ext = extname(filePath).toLowerCase();
          const relResolved = formatTemplatePath(filePath, this.config.root);
          const existsInContext = getNestedValue(context, attrs.src) !== undefined;

          let hint: string;
          if (ext && ext !== ".json") {
            if (existsInContext) {
              hint =
                `Resolved file "${relResolved}" has extension "${ext}", not ".json".\n` +
                `"${attrs.src}" is available in template context — use <each in="${attrs.src}"> or point "src" to a .json file (e.g. <each src="${attrs.src}.json">).`;
            } else {
              hint =
                `Resolved file "${relResolved}" has extension "${ext}", not ".json".\n` +
                `Use <each in="${attrs.src}"> to iterate data from context, or point "src" to a .json file (e.g. <each src="${attrs.src}.json">).`;
            }
          } else {
            hint = `Check that "${relResolved}" contains valid JSON syntax.`;
          }

          throw new BunticTemplateError({
            message: `[Buntic] Failed to parse JSON data file for <each src="${attrs.src}">`,
            location,
            projectRoot: this.config.root,
            resolvedTarget: filePath,
            cause: err,
            hint,
          });
        }
      } else if (attrs.in) {
        items = getNestedValue(context, attrs.in);
      } else {
        const location = await locateEachItem(item);
        throw new BunticTemplateError({
          message: `[Buntic] <each> tag requires either a "src" or "in" attribute.`,
          location,
          projectRoot: this.config.root,
          hint: `Use <each src="data.json"> for a JSON file or <each in="items"> for a context variable.`,
        });
      }

      // Undefined / null context source with explicit <else> or <default> fallback
      if ((items === undefined || items === null) && (elseBlock || defaultBlock)) {
        const fallbackContent = (elseBlock ?? defaultBlock)!.inner;
        const renderedFallback = await renderFallbackBlock(fallbackContent);
        result = replaceLiteral(result, item.fullMatch, renderedFallback);
        continue;
      }

      if (!Array.isArray(items)) {
        const location = await locateEachItem(item);
        const receivedType = items === null ? "null" : typeof items;
        let hint: string;
        if (attrs.in && items === undefined) {
          const availableKeys = Object.keys(context).filter((k) => k !== "env");
          const keysNote =
            availableKeys.length > 0
              ? ` Available top-level keys: ${availableKeys.join(", ")}.`
              : "";
          hint =
            `Context path "${attrs.in}" is undefined. Check the variable name (page loader data lives under "props.*") or add an <else> / <default> fallback inside <each>.${keysNote}`;
        } else {
          hint = `<each> expects an array, but "${attrs.src || attrs.in}" resolved to ${receivedType}.`;
        }

        throw new BunticTemplateError({
          message: `[Buntic] <each> source "${attrs.src || attrs.in}" did not resolve to an array (received ${receivedType}).`,
          location,
          projectRoot: this.config.root,
          resolvedTarget: resolvedFilePath,
          hint,
        });
      }

      // Empty array with optional <none> or <default> fallback
      if (items.length === 0) {
        const fallback = noneBlock ?? defaultBlock;
        const renderedFallback = fallback ? await renderFallbackBlock(fallback.inner) : "";
        result = replaceLiteral(result, item.fullMatch, renderedFallback);
        continue;
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

        let rendered = await this.resolveEach(loopTemplate, itemContext, currentFile, depth + 1);
        rendered = await this.resolveComponents(rendered, itemContext, currentFile, depth + 1);
        rendered = this.resolveConditionals(rendered, itemContext, currentFile, originalSourceForFile);
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
      console.warn("[Buntic] Maximum component recursion depth (10) reached. Check for circular component includes.");
      return html;
    }

    const componentRegex = /<component\s+([^>]+?)(?:\s*\/>|>(.*?)<\/component>)/gis;
    const matches: Array<{
      fullMatch: string;
      openTag: string;
      children: string;
      src: string;
      props: Record<string, string>;
      index: number;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(html)) !== null) {
      const props = parseHtmlAttributes(match[1]);
      if (props.src) {
        const fullMatch = match[0];
        const openTagEnd = fullMatch.indexOf(">");
        matches.push({
          fullMatch,
          openTag: openTagEnd !== -1 ? fullMatch.slice(0, openTagEnd + 1) : fullMatch,
          children: match[2] ? match[2].trim() : "",
          src: props.src,
          props,
          index: match.index,
        });
      }
    }

    if (matches.length === 0) return html;

    let result = html;
    for (const item of matches) {
      const compPath = this.resolveFilePath(item.src, currentFile, this.config.componentsDir);
      if (!this.vfs.hasFile(compPath) && !existsSync(compPath)) {
        const originalSource = await this.getOriginalSource(currentFile, html);
        const location = findSnippetLocation({
          source: originalSource,
          snippet: item.fullMatch,
          openTag: item.openTag,
          fallbackHtml: html,
          fallbackOffset: item.index,
          filePath: currentFile || undefined,
        });
        const compDirDisplay = formatTemplatePath(this.config.componentsDir, this.config.root);
        throw new BunticTemplateError({
          message: `[Buntic] Component not found: "${item.src}" at ${compPath}`,
          location,
          projectRoot: this.config.root,
          resolvedTarget: compPath,
          hint: `Check that "${item.src}" exists in "${compDirDisplay}" or verify the relative path in <component src="${item.src}">.`,
        });
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
          snippet: item.fullMatch,
          openTag: item.openTag,
          offset: item.index,
          sourceHtml: html,
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

      const rawCompTemplate = await this.vfs.readText(compPath);
      let compTemplate = await attachSiblingCssIfPresent({
        templateHtml: rawCompTemplate,
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
      compTemplate = this.resolveConditionals(compTemplate, compContext, compPath, rawCompTemplate);
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
    snippet?: string;
    openTag?: string;
    offset?: number;
    sourceHtml?: string;
  }): Promise<string> {
    const {
      compPath,
      rawSrc,
      props,
      children,
      context,
      currentFile,
      depth,
      snippet,
      openTag,
      offset,
      sourceHtml,
    } = options;

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
      const originalSource = await this.getOriginalSource(currentFile, sourceHtml || "");
      const location = findSnippetLocation({
        source: originalSource,
        snippet: snippet || "",
        openTag,
        fallbackHtml: sourceHtml,
        fallbackOffset: offset,
        filePath: currentFile || undefined,
      });
      throw new BunticTemplateError({
        message:
          `[Buntic] Could not determine Custom Element tag name for Web Component file "${rawSrc}". ` +
          `Ensure the filename follows kebab-case (e.g. "my-element.ts") or PascalCase (e.g. "MyElement.ts").`,
        location,
        projectRoot: this.config.root,
        resolvedTarget: compPath,
      });
    }

    const attrEntries = Object.entries(props).filter(([k]) => k !== "src");
    const attrString =
      attrEntries.length > 0
        ? " " + attrEntries.map(([k, v]) => `${k}="${v}"`).join(" ")
        : "";

    let innerChildren = children;
    if (innerChildren) {
      innerChildren = await this.resolveComponents(innerChildren, context, currentFile, depth + 1);
      innerChildren = this.resolveConditionals(innerChildren, context, currentFile, sourceHtml);
      innerChildren = this.interpolate(innerChildren, context);
    }

    return innerChildren
      ? `<${tag}${attrString}>${innerChildren}</${tag}>`
      : `<${tag}${attrString}></${tag}>`;
  }

  public resolveConditionals(
    html: string,
    context: TemplateContext,
    currentFile = "",
    originalSource?: string
  ): string {
    return resolveConditionals(html, context, {
      filePath: currentFile || undefined,
      source: originalSource,
      projectRoot: this.config.root,
    });
  }

  public interpolate(html: string, context: TemplateContext): string {
    return interpolateTemplate(html, context);
  }
}
