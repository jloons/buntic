import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";
import { VirtualFileSystem } from "./vfs.ts";

export class TemplateEngine {
  private config: ResolvedConfig;
  public vfs: VirtualFileSystem;
  private cachedData: Record<string, any> | null = null;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.vfs = new VirtualFileSystem(this.config.root);
  }

  /**
   * Loads all JSON files in the data directory into a key-value map.
   * e.g. data/site.json -> { site: { ... } }
   */
  public async loadData(): Promise<Record<string, any>> {
    if (this.cachedData) return this.cachedData;

    const data: Record<string, any> = {};
    const files = this.vfs.getFilesInDirectory(this.config.dataDir);

    for (const fullPath of files) {
      if (fullPath.endsWith(".json")) {
        const lastSlash = fullPath.lastIndexOf("/");
        const fileName = lastSlash !== -1 ? fullPath.slice(lastSlash + 1) : fullPath;
        const key = fileName.replace(/\.json$/, "");
        try {
          data[key] = await this.vfs.readJson(fullPath);
        } catch {
          // Ignore unparseable JSON files
        }
      }
    }

    this.cachedData = data;
    return data;
  }

  public invalidateDataCache(): void {
    this.cachedData = null;
  }

  /**
   * Invalidate VFS cache and data cache.
   */
  public invalidateCache(filePath?: string): void {
    this.cachedData = null;
    this.vfs.invalidateFile(filePath);
  }

  /**
   * Main entry point: renders a page HTML string by:
   * 1. Resolving <layout> and <slot>
   * 2. Resolving <each> blocks
   * 3. Resolving <component> tags recursively
   * 4. Resolving conditionals (if attribute and <if> block)
   * 5. Interpolating data variables (with ?? fallback support)
   */
  public async renderPage(pageHtml: string, currentFile = ""): Promise<string> {
    const data = await this.loadData();
    const context: Record<string, any> = { ...data };

    // 1. Resolve Layout (if page specifies <layout src="...">)
    let composed = await this.resolveLayout(pageHtml, context, currentFile);

    // 2. Resolve <each> blocks
    composed = await this.resolveEach(composed, context, currentFile);

    // 3. Resolve any remaining components
    composed = await this.resolveComponents(composed, context, currentFile);

    // 4. Resolve Conditionals
    composed = this.resolveConditionals(composed, context);

    // 5. Interpolate data variables
    composed = this.interpolate(composed, context);

    return composed;
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

    // Extract named slots and default content
    const slots = new Map<string, string>();
    const slotElRegex = /<([a-zA-Z0-9_-]+)\s+[^>]*slot=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
    const defaultContent = resolvedInner.replace(slotElRegex, (_match, _tag, slotName, content) => {
      slots.set(slotName, content.trim());
      return "";
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

      let compTemplate = await this.vfs.readText(compPath);

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
    return html.replace(/\{\{([a-zA-Z0-9_.-]+)(?:\s*\?\?\s*["']([^"']*)["'])?\}\}/g, (match, key, fallback) => {
      const trimmed = key.trim();
      const val = this.getNestedValue(context, trimmed);
      if (val !== undefined && val !== null && val !== "") return String(val);
      if (fallback !== undefined) return fallback;
      return "";
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
}
