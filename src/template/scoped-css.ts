/**
 * Bustatic Scoped CSS Processor
 * Handles <style scoped> blocks, scoping selectors with &,
 * deduplication, collision-free class generation, and CSS transformation.
 */

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface ScopedCssExtraction {
  html: string;
  scopedRules: string[];
}

export interface RootElementInfo {
  tag: string;
  openTagStart: number;
  openTagEnd: number;
  openTagRaw: string;
}

/**
 * Validates whether an HTML string has exactly one top-level container element.
 * Returns information about the root element's opening tag, or null if there are
 * multiple root elements (fragment), no elements, or non-whitespace root text.
 */
export function findSingleRootElement(html: string): RootElementInfo | null {
  const tagRegex =
    /<!--[\s\S]*?-->|<\/([a-zA-Z0-9_-]+)\s*>|<([a-zA-Z0-9_-]+)((?:\s+[^"'<>]+|='[^']*'|="[^"]*"|=[^\s"'>]+)*)\s*(\/?)>/gi;

  let match: RegExpExecArray | null;
  let firstRoot: RootElementInfo | null = null;
  let depth = 0;
  let lastIndexChecked = 0;
  let rootClosedIndex = -1;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;

    // Check if there was non-whitespace text before this tag at root level
    if (depth === 0) {
      const textBefore = html.slice(lastIndexChecked, matchStart).trim();
      if (textBefore.length > 0) {
        return null;
      }
    }

    lastIndexChecked = matchEnd;

    // Skip HTML comments
    if (fullMatch.startsWith("<!--")) {
      continue;
    }

    const closingTag = match[1];
    const openingTag = match[2];
    const isSelfClosing = match[4] === "/";

    if (openingTag) {
      const lower = openingTag.toLowerCase();
      const isVoid = VOID_ELEMENTS.has(lower);

      if (depth === 0) {
        if (firstRoot !== null) {
          // More than one root element found (fragment)
          return null;
        }

        if (isVoid || isSelfClosing) {
          // A void or self-closing tag cannot contain scoped styles
          return null;
        }

        firstRoot = {
          tag: openingTag,
          openTagStart: matchStart,
          openTagEnd: matchEnd,
          openTagRaw: fullMatch,
        };
        depth = 1;
      } else {
        if (!isVoid && !isSelfClosing) {
          depth++;
        }
      }
    } else if (closingTag) {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          rootClosedIndex = matchEnd;
        }
      }
    }
  }

  // Tags must be balanced, exactly one root found and closed
  if (depth !== 0 || !firstRoot || rootClosedIndex === -1) {
    return null;
  }

  // Check if there is non-whitespace text after the root closed
  const trailingText = html.slice(rootClosedIndex).trim();
  const trailingWithoutComments = trailingText.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (trailingWithoutComments.length > 0) {
    return null;
  }

  return firstRoot;
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
   * - Identical CSS content returns the exact same class ID (deduplication).
   * - Different CSS content that collides on the base hash gets disambiguated (-1, -2, etc.).
   */
  public getScopeId(cssContent: string): string {
    const normalized = cssContent.trim().replace(/\r\n/g, "\n");
    // Generate base36 short hash from 64-bit integer
    const hashNum = Bun.hash(normalized);
    const baseHash = "bs-" + (typeof hashNum === "bigint" ? hashNum.toString(36) : Number(hashNum).toString(36)).slice(0, 7);

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
 * Transforms scoped CSS rules to apply under the given scopeClass:
 * - `&` and `:host` replaced by `.${scopeClass}`
 * - Combinators (`> p`) prefixed as `.${scopeClass} > p`
 * - Descendants (`p`, `.btn`) prefixed as `.${scopeClass} p`
 * - Comma-separated selectors handled individually
 * - `@media` rules have their inner blocks scoped
 * - `@keyframes` and `@font-face` preserved without scoping
 */
export function transformScopedCss(css: string, scopeTarget: string, isElement = false): string {
  const targetClass = isElement
    ? scopeTarget
    : scopeTarget.startsWith(".")
      ? scopeTarget
      : `.${scopeTarget}`;
  const cleanCss = css.trim().replace(/\r\n/g, "\n");

  const transformedRules: string[] = [];
  const blocks = splitCssBlocks(cleanCss);

  for (const block of blocks) {
    if (block.type === "at-rule-nested") {
      // e.g. @media, @supports, @container
      const innerTransformed = transformScopedCss(block.body, scopeTarget, isElement);
      transformedRules.push(`${block.header} {\n${indent(innerTransformed, "  ")}\n}`);
    } else if (block.type === "at-rule-leaf") {
      // e.g. @keyframes, @font-face, @charset, @import
      transformedRules.push(block.raw);
    } else if (block.type === "rule") {
      const scopedSelector = scopeSelectorList(block.selector, targetClass);
      transformedRules.push(`${scopedSelector} {\n${block.body}\n}`);
    }
  }

  return transformedRules.join("\n\n");
}

function scopeSelectorList(selectorList: string, targetClass: string): string {
  const selectors = splitSelectorList(selectorList);
  return selectors
    .map((s) => scopeSingleSelector(s.trim(), targetClass))
    .filter(Boolean)
    .join(", ");
}

function scopeSingleSelector(selector: string, targetClass: string): string {
  if (!selector) return "";

  // 1. If selector uses & (CSS nesting) or :host (Web Components alias)
  if (selector.includes("&") || selector.includes(":host")) {
    return selector
      .replace(/&/g, targetClass)
      .replace(/:host\b/g, targetClass);
  }

  // 2. If selector starts with a direct combinator (e.g. `> p`, `+ span`, `~ div`)
  if (/^[>+~]/.test(selector)) {
    return `${targetClass} ${selector}`.replace(/\s+/g, " ");
  }

  // 3. Regular descendant selector (e.g. `p`, `h1`, `.card`, `#btn`)
  return `${targetClass} ${selector}`;
}

/**
 * Splits a comma-separated selector string without splitting inside parentheses (e.g. :is(a, b)).
 */
function splitSelectorList(selectors: string): string[] {
  const result: string[] = [];
  let current = "";
  let parenDepth = 0;

  for (let i = 0; i < selectors.length; i++) {
    const ch = selectors[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (ch === "," && parenDepth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

interface CssBlock {
  type: "rule" | "at-rule-nested" | "at-rule-leaf";
  header: string;
  selector: string;
  body: string;
  raw: string;
}

/**
 * Parses CSS into top-level blocks while tracking braces.
 */
function splitCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(css[i])) i++;
    if (i >= len) break;

    // Skip comments
    if (css[i] === "/" && css[i + 1] === "*") {
      const commentEnd = css.indexOf("*/", i + 2);
      i = commentEnd === -1 ? len : commentEnd + 2;
      continue;
    }

    // Find opening brace '{' or semicolon ';' (for leaf at-rules like @import)
    let headerStart = i;
    let braceIndex = -1;
    let semiIndex = -1;

    for (let j = i; j < len; j++) {
      if (css[j] === "/" && css[j + 1] === "*") {
        const cEnd = css.indexOf("*/", j + 2);
        j = cEnd === -1 ? len - 1 : cEnd + 1;
        continue;
      }
      if (css[j] === "{") {
        braceIndex = j;
        break;
      }
      if (css[j] === ";" && css.slice(headerStart, j).trim().startsWith("@")) {
        semiIndex = j;
        break;
      }
    }

    if (braceIndex === -1 && semiIndex !== -1) {
      // Leaf at-rule without body, e.g. @import "...";
      const raw = css.slice(headerStart, semiIndex + 1).trim();
      blocks.push({
        type: "at-rule-leaf",
        header: raw,
        selector: "",
        body: "",
        raw,
      });
      i = semiIndex + 1;
      continue;
    }

    if (braceIndex === -1) {
      // No more rules
      break;
    }

    const header = css.slice(headerStart, braceIndex).trim();

    // Find matching closing brace
    let depth = 1;
    let bodyStart = braceIndex + 1;
    let bodyEnd = -1;

    for (let j = bodyStart; j < len; j++) {
      if (css[j] === "/" && css[j + 1] === "*") {
        const cEnd = css.indexOf("*/", j + 2);
        j = cEnd === -1 ? len - 1 : cEnd + 1;
        continue;
      }
      if (css[j] === "{") {
        depth++;
      } else if (css[j] === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = j;
          break;
        }
      }
    }

    if (bodyEnd === -1) {
      // Malformed CSS, take rest of file
      bodyEnd = len;
    }

    const body = css.slice(bodyStart, bodyEnd).trim();
    const raw = css.slice(headerStart, bodyEnd + 1).trim();

    if (header.startsWith("@")) {
      const lower = header.toLowerCase();
      if (
        lower.startsWith("@media") ||
        lower.startsWith("@supports") ||
        lower.startsWith("@container")
      ) {
        blocks.push({
          type: "at-rule-nested",
          header,
          selector: "",
          body,
          raw,
        });
      } else {
        // e.g. @keyframes, @font-face, @counter-style
        blocks.push({
          type: "at-rule-leaf",
          header,
          selector: "",
          body,
          raw,
        });
      }
    } else {
      blocks.push({
        type: "rule",
        header,
        selector: header,
        body,
        raw,
      });
    }

    i = bodyEnd + 1;
  }

  return blocks;
}

function indent(text: string, spaces: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() ? spaces + line : line))
    .join("\n");
}

interface TagOpenInfo {
  tag: string;
  start: number;
  end: number;
  raw: string;
}

/**
 * Finds the parent opening tag of <style scoped> by tracking the HTML tag stack
 * up to the position of the style tag.
 */
function findParentTagOfScopedStyle(
  html: string,
  styleStartIdx: number
): TagOpenInfo | null {
  const textBefore = html.slice(0, styleStartIdx);
  const stack: TagOpenInfo[] = [];

  // Match HTML tags: <!-- comments --> or <tag ...> or </tag>
  const tagRegex = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9_-]+)\s*>|<([a-zA-Z0-9_-]+)((?:\s+[^"'<>]+|='[^']*'|="[^"]*"|=[^\s"'>]+)*)\s*(\/?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(textBefore)) !== null) {
    const fullTag = match[0];
    if (fullTag.startsWith("<!--")) continue;

    const closingTag = match[1];
    const openingTag = match[2];
    const isSelfClosing = match[4] === "/";

    if (closingTag) {
      const lower = closingTag.toLowerCase();
      // Pop matching opening tag
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag.toLowerCase() === lower) {
          stack.splice(s, 1);
          break;
        }
      }
    } else if (openingTag) {
      const lower = openingTag.toLowerCase();
      if (!VOID_ELEMENTS.has(lower) && !isSelfClosing) {
        stack.push({
          tag: openingTag,
          start: match.index,
          end: match.index + fullTag.length,
          raw: fullTag,
        });
      }
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Injects a class name into an HTML element opening tag.
 */
function addClassToOpenTag(openTag: string, newClass: string): string {
  const classMatch = openTag.match(/class=(["'])(.*?)\1/i);
  if (classMatch) {
    const quote = classMatch[1];
    const existingClasses = classMatch[2].trim();
    if (existingClasses.split(/\s+/).includes(newClass)) {
      return openTag; // Already has class
    }
    const updated = existingClasses ? `${existingClasses} ${newClass}` : newClass;
    return openTag.replace(classMatch[0], `class=${quote}${updated}${quote}`);
  }

  // No class attribute present; insert class before closing '>' or '/>'
  if (openTag.endsWith("/>")) {
    return openTag.slice(0, -2).trimEnd() + ` class="${newClass}"/>`;
  }
  return openTag.slice(0, -1).trimEnd() + ` class="${newClass}">`;
}

/**
 * Extracts all <style scoped> blocks from HTML:
 * 1. Finds enclosing parent element and adds unique scoped class to its opening tag.
 * 2. Transforms CSS rules with `transformScopedCss`.
 * 3. Removes the `<style scoped>...</style>` block from the HTML.
 */
export function extractScopedStyles(
  html: string,
  registry: ScopeRegistry = new ScopeRegistry()
): ScopedCssExtraction {
  let currentHtml = html;
  const scopedRules: string[] = [];
  const emittedClasses = new Set<string>();

  // Regex to match <style scoped> or <style scoped="..." ...>
  // We process one by one to ensure accurate stack parsing after every mutation
  const scopedTagRegex = /<style\b(?=[^>]*\bscoped\b)[^>]*>([\s\S]*?)<\/style>/i;

  let match: RegExpExecArray | null;
  while ((match = scopedTagRegex.exec(currentHtml)) !== null) {
    const fullStyleBlock = match[0];
    const cssContent = match[1];
    const styleStartIndex = match.index;

    const parent = findParentTagOfScopedStyle(currentHtml, styleStartIndex);
    const scopeClass = registry.getScopeId(cssContent);

    if (parent) {
      // Modify parent tag to include class
      const updatedParentTag = addClassToOpenTag(parent.raw, scopeClass);

      // Replace parent tag and remove style tag
      const beforeParent = currentHtml.slice(0, parent.start);
      const afterParentStart = currentHtml.slice(parent.end, styleStartIndex);
      const afterStyle = currentHtml.slice(styleStartIndex + fullStyleBlock.length);

      currentHtml = beforeParent + updatedParentTag + afterParentStart + afterStyle;
    } else {
      // No parent found (e.g. style at root); simply remove style tag
      currentHtml =
        currentHtml.slice(0, styleStartIndex) +
        currentHtml.slice(styleStartIndex + fullStyleBlock.length);
    }

    // Transform and deduplicate CSS rules
    if (!emittedClasses.has(scopeClass)) {
      emittedClasses.add(scopeClass);
      const transformedCss = transformScopedCss(cssContent, scopeClass);
      if (transformedCss.trim()) {
        scopedRules.push(transformedCss);
      }
    }
  }

  return {
    html: currentHtml,
    scopedRules,
  };
}
