/**
 * Bustatic Scoped CSS Processor
 * Handles <style scoped> blocks, scoping registry, sibling CSS attachment,
 * and depth-ordered extraction.
 */

import { transformScopedCss } from "./css-scoper.ts";
import {
  addClassToOpenTag,
  findParentTagOfScopedStyle,
  findSingleRootElement,
  type RootElementInfo,
} from "./html-scanner.ts";

export { findSingleRootElement, transformScopedCss, type RootElementInfo };

export interface ScopedCssExtraction {
  html: string;
  scopedRules: string[];
}

/**
 * Injects a scoped CSS block into the root element of an HTML template.
 * Returns null if the template does not have a single root element.
 */
export function attachSiblingScopedCss(
  html: string,
  cssContent: string
): string | null {
  const root = findSingleRootElement(html);
  if (!root) return null;

  const styleTag = `\n<style scoped>\n${cssContent}\n</style>`;
  return html.slice(0, root.openTagEnd) + styleTag + html.slice(root.openTagEnd);
}

export class ScopeRegistry {
  private registry = new Map<string, string>(); // classId -> normalizedCss

  /**
   * Generates a deterministic, collision-free scope class ID.
   */
  public getScopeId(cssContent: string): string {
    const normalized = cssContent.trim().replace(/\r\n/g, "\n");
    const hashNum = Bun.hash(normalized);
    const baseHash =
      "bs-" +
      (typeof hashNum === "bigint" ? hashNum.toString(36) : Number(hashNum).toString(36)).slice(0, 7);

    let candidate = baseHash;
    let counter = 1;

    while (this.registry.has(candidate)) {
      if (this.registry.get(candidate) === normalized) {
        return candidate;
      }
      candidate = `${baseHash}-${counter++}`;
    }

    this.registry.set(candidate, normalized);
    return candidate;
  }

  public clear(): void {
    this.registry.clear();
  }
}

/**
 * Extracts all `<style scoped>` blocks from HTML, injects deterministic scope classes
 * onto enclosing parent tags, and orders emitted rules by ascending DOM depth.
 */
export function extractScopedStyles(
  html: string,
  registry: ScopeRegistry = new ScopeRegistry()
): ScopedCssExtraction {
  let currentHtml = html;
  const ruleEntries = new Map<string, { css: string; depth: number; order: number }>();
  let orderCounter = 0;

  const scopedTagRegex = /<style\b(?=[^>]*\s+scoped(?=[\s=>]))[^>]*>([\s\S]*?)<\/style>/i;

  let match: RegExpExecArray | null;
  while ((match = scopedTagRegex.exec(currentHtml)) !== null) {
    const fullStyleBlock = match[0];
    const cssContent = match[1];
    const styleStartIndex = match.index;

    const parent = findParentTagOfScopedStyle(currentHtml, styleStartIndex);
    const depth = parent ? parent.depth : 0;
    const scopeClass = registry.getScopeId(cssContent);

    if (parent) {
      const updatedParentTag = addClassToOpenTag(parent.raw, scopeClass);
      const beforeParent = currentHtml.slice(0, parent.start);
      const afterParentStart = currentHtml.slice(parent.end, styleStartIndex);
      const afterStyle = currentHtml.slice(styleStartIndex + fullStyleBlock.length);

      currentHtml = beforeParent + updatedParentTag + afterParentStart + afterStyle;
    } else {
      currentHtml =
        currentHtml.slice(0, styleStartIndex) +
        currentHtml.slice(styleStartIndex + fullStyleBlock.length);
    }

    const existing = ruleEntries.get(scopeClass);
    if (!existing) {
      const transformedCss = transformScopedCss(cssContent, scopeClass);
      if (transformedCss.trim()) {
        ruleEntries.set(scopeClass, {
          css: transformedCss,
          depth,
          order: orderCounter++,
        });
      }
    } else if (depth > existing.depth) {
      existing.depth = depth;
    }
  }

  const scopedRules = Array.from(ruleEntries.values())
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((entry) => entry.css);

  return {
    html: currentHtml,
    scopedRules,
  };
}
