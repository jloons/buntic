import { join, resolve, dirname } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { ResolvedConfig } from "../types.ts";

export class TemplateEngine {
  private config: ResolvedConfig;
  private cachedData: Record<string, any> | null = null;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  /**
   * Loads all JSON files in the data directory into a key-value map.
   * e.g. data/site.json -> { site: { ... } }
   */
  public async loadData(): Promise<Record<string, any>> {
    if (this.cachedData) return this.cachedData;

    const data: Record<string, any> = {};
    if (!existsSync(this.config.dataDir)) {
      this.cachedData = data;
      return data;
    }

    try {
      const files = readdirSync(this.config.dataDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const key = file.replace(/\.json$/, "");
          const fullPath = join(this.config.dataDir, file);
          const fileRef = Bun.file(fullPath);
          data[key] = await fileRef.json();
        }
      }
    } catch {
      // Ignored if data directory is empty or cannot be read
    }

    this.cachedData = data;
    return data;
  }

  public invalidateDataCache(): void {
    this.cachedData = null;
  }

  /**
   * Main entry point: renders a page HTML string by:
   * 1. Interpolating data variables
   * 2. Resolving <layout> and <slot>
   * 3. Resolving <component> tags recursively
   */
  public async renderPage(pageHtml: string, currentFile = ""): Promise<string> {
    const data = await this.loadData();
    const context: Record<string, any> = { ...data };

    // 1. Resolve Layout (if page specifies <layout src="...">)
    let composed = await this.resolveLayout(pageHtml, context, currentFile);

    // 2. Resolve any remaining components
    composed = await this.resolveComponents(composed, context, currentFile);

    // 3. Interpolate data variables
    composed = this.interpolate(composed, context);

    return composed;
  }

  /**
   * Resolves a file path referenced in a template.
   * Priority:
   * 1. Explicit relative path (./ or ../) relative to currentFile
   * 2. Root-relative path (/layouts/main.html) relative to config.root
   * 3. Implicit relative to currentFile directory
   * 4. Convention directory (e.g. layoutsDir or componentsDir)
   * 5. Project root directly
   */
  public resolveFilePath(rawSrc: string, currentFile: string, defaultDir: string): string {
    const src = rawSrc;
    const srcWithHtml = src.endsWith(".html") ? src : `${src}.html`;
    const candidates: string[] = [];

    // 1. Explicit relative path (./ or ../)
    if (src.startsWith("./") || src.startsWith("../")) {
      const fromDir = currentFile ? dirname(currentFile) : this.config.root;
      candidates.push(resolve(fromDir, src));
      candidates.push(resolve(fromDir, srcWithHtml));
    }

    // 2. Root-relative (/layouts/main.html or /components/card.html)
    if (src.startsWith("/")) {
      const clean = src.slice(1);
      candidates.push(resolve(this.config.root, clean));
      candidates.push(resolve(this.config.root, srcWithHtml.slice(1)));
    }

    // 3. Current file directory implicit relative
    if (currentFile && !src.startsWith("/")) {
      const fromDir = dirname(currentFile);
      candidates.push(resolve(fromDir, src));
      candidates.push(resolve(fromDir, srcWithHtml));
    }

    // 4. Default convention directory (e.g. layouts/ or components/)
    candidates.push(resolve(defaultDir, src));
    candidates.push(resolve(defaultDir, srcWithHtml));

    // 5. Project root
    candidates.push(resolve(this.config.root, src));
    candidates.push(resolve(this.config.root, srcWithHtml));

    for (const cand of candidates) {
      if (existsSync(cand) && !statSync(cand).isDirectory()) {
        return cand;
      }
    }

    return candidates[0] || resolve(defaultDir, srcWithHtml);
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
    if (!existsSync(layoutFilePath)) {
      throw new Error(`[Bustatic] Layout not found: "${layoutRawSrc}" at ${layoutFilePath}`);
    }

    let layoutTemplate = await Bun.file(layoutFilePath).text();

    // First, resolve components inside the page inner content using the page's currentFile path
    const resolvedInnerContent = await this.resolveComponents(innerContent, context, currentFile);

    // Extract named slots and default content
    const slots = new Map<string, string>();
    const slotElRegex = /<([a-zA-Z0-9_-]+)\s+[^>]*slot=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
    const defaultContent = resolvedInnerContent.replace(slotElRegex, (_match, _tag, slotName, content) => {
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

    // Now resolve components that originated in the layout file, using layoutFilePath as reference
    rendered = await this.resolveComponents(rendered, context, layoutFilePath);

    return rendered;
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

      if (!existsSync(compPath)) {
        throw new Error(`[Bustatic] Component not found: "${item.src}" at ${compPath}`);
      }

      let compTemplate = await Bun.file(compPath).text();

      // Combined props with global data
      const compContext = { ...context, ...item.props };

      // Replace component default slot if children provided
      compTemplate = compTemplate.replace(/<slot\s*>\s*<\/slot>/gi, item.children);
      compTemplate = compTemplate.replace(/<slot\s*\/>/gi, item.children);

      // Interpolate props inside the component
      compTemplate = this.interpolate(compTemplate, compContext);

      // Recurse to resolve any components that were inside this component file
      compTemplate = await this.resolveComponents(compTemplate, compContext, compPath, depth + 1);

      // Replace in parent
      result = result.replace(item.fullMatch, compTemplate);
    }

    return result;
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

  private interpolate(html: string, context: Record<string, any>): string {
    return html.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (match, key) => {
      const trimmed = key.trim();
      const val = this.getNestedValue(context, trimmed);
      return val !== undefined ? String(val) : match;
    });
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let cur = obj;
    for (const part of parts) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }
}
