/**
 * Pure CSS block parsing and selector scoping transformation helpers.
 */

interface CssBlock {
  type: "rule" | "at-rule-nested" | "at-rule-leaf";
  header: string;
  selector: string;
  body: string;
  raw: string;
}

/**
 * Transforms scoped CSS rules to apply under the given `scopeTarget`:
 * - `&` and `:host` replaced by `.${scopeTarget}` (or raw element tag if `isElement`)
 * - Combinators (`> p`) prefixed as `.${scopeTarget} > p`
 * - Descendants (`p`, `.btn`) prefixed as `.${scopeTarget} p`
 * - `@media` / `@supports` / `@container` recursively scoped
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
      const innerTransformed = transformScopedCss(block.body, scopeTarget, isElement);
      transformedRules.push(`${block.header} {\n${indent(innerTransformed, "  ")}\n}`);
    } else if (block.type === "at-rule-leaf") {
      transformedRules.push(block.raw);
    } else if (block.type === "rule") {
      const scopedSelector = scopeSelectorList(block.selector, targetClass);
      transformedRules.push(`${scopedSelector} {\n${block.body}\n}`);
    }
  }

  return transformedRules.join("\n\n");
}

function scopeSelectorList(selectorList: string, targetClass: string): string {
  return splitSelectorList(selectorList)
    .map((s) => scopeSingleSelector(s.trim(), targetClass))
    .filter(Boolean)
    .join(", ");
}

function scopeSingleSelector(selector: string, targetClass: string): string {
  if (!selector) return "";

  if (selector.includes("&") || selector.includes(":host")) {
    return selector
      .replace(/&/g, () => targetClass)
      .replace(/:host\b/g, () => targetClass);
  }

  if (/^[>+~]/.test(selector)) {
    return `${targetClass} ${selector}`.replace(/\s+/g, " ");
  }

  return `${targetClass} ${selector}`;
}

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

function splitCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    while (i < len && /\s/.test(css[i])) i++;
    if (i >= len) break;

    if (css[i] === "/" && css[i + 1] === "*") {
      const commentEnd = css.indexOf("*/", i + 2);
      i = commentEnd === -1 ? len : commentEnd + 2;
      continue;
    }

    const headerStart = i;
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
      break;
    }

    const header = css.slice(headerStart, braceIndex).trim();

    let depth = 1;
    const bodyStart = braceIndex + 1;
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
      bodyEnd = len;
    }

    const body = css.slice(bodyStart, bodyEnd).trim();
    const raw = css.slice(headerStart, bodyEnd + 1).trim();

    if (header.startsWith("@")) {
      const lower = header.toLowerCase();
      const isNested =
        lower.startsWith("@media") ||
        lower.startsWith("@supports") ||
        lower.startsWith("@container");
      blocks.push({
        type: isNested ? "at-rule-nested" : "at-rule-leaf",
        header,
        selector: "",
        body,
        raw,
      });
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
