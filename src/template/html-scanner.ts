/**
 * HTML structural scanning helpers used by Scoped CSS and SVG attribute merging.
 */

export const VOID_ELEMENTS = new Set([
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

export interface RootElementInfo {
  tag: string;
  openTagStart: number;
  openTagEnd: number;
  openTagRaw: string;
}

export interface TagOpenInfo {
  tag: string;
  start: number;
  end: number;
  raw: string;
  depth: number;
}

/**
 * Creates a fresh HTML tokenizer regex for tag-stack analysis:
 * - Skips HTML comments, XML prologues, `<!doctype ...>`, `<script>...</script>`, and `<style>...</style>`
 * - Captures closing tag name (group 1), opening tag name (group 2), attributes (group 3), and self-closing "/" (group 4)
 */
export function createHtmlTagRegex(): RegExp {
  return /<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<!doctype[^>]*>|<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script>|<style\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style>|<\/([a-zA-Z0-9_:-]+)\s*>|<([a-zA-Z0-9_:-]+)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|(?:\x2f(?!>)|[^\s"'=<>`\/])+))?)*)\s*(\/?)>/gi;
}

/**
 * Validates whether an HTML string has exactly one top-level container element.
 * Returns information about the root element's opening tag, or null otherwise.
 */
export function findSingleRootElement(html: string): RootElementInfo | null {
  const tagRegex = createHtmlTagRegex();

  let match: RegExpExecArray | null;
  let firstRoot: RootElementInfo | null = null;
  let depth = 0;
  let lastIndexChecked = 0;
  let rootClosedIndex = -1;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;

    if (depth === 0) {
      const textBefore = html.slice(lastIndexChecked, matchStart).trim();
      if (textBefore.length > 0) {
        return null;
      }
    }

    lastIndexChecked = matchEnd;

    if (fullMatch.startsWith("<!--") || fullMatch.startsWith("<?xml") || /^<!doctype\b/i.test(fullMatch)) {
      continue;
    }

    if (/^<(?:script|style)\b/i.test(fullMatch)) {
      if (depth === 0) {
        return null;
      }
      continue;
    }

    const closingTag = match[1];
    const openingTag = match[2];
    const isSelfClosing = match[4] === "/";

    if (openingTag) {
      const lower = openingTag.toLowerCase();
      const isVoid = VOID_ELEMENTS.has(lower);

      if (depth === 0) {
        if (firstRoot !== null || isVoid || isSelfClosing) {
          return null;
        }

        firstRoot = {
          tag: openingTag,
          openTagStart: matchStart,
          openTagEnd: matchEnd,
          openTagRaw: fullMatch,
        };
        depth = 1;
      } else if (!isVoid && !isSelfClosing) {
        depth++;
      }
    } else if (closingTag && depth > 0) {
      depth--;
      if (depth === 0) {
        rootClosedIndex = matchEnd;
      }
    }
  }

  if (depth !== 0 || !firstRoot || rootClosedIndex === -1) {
    return null;
  }

  const trailingText = html.slice(rootClosedIndex).trim();
  const trailingWithoutComments = trailingText.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (trailingWithoutComments.length > 0) {
    return null;
  }

  return firstRoot;
}

/**
 * Finds the parent opening tag of `<style scoped>` by tracking the HTML tag stack
 * up to `styleStartIdx`.
 */
export function findParentTagOfScopedStyle(
  html: string,
  styleStartIdx: number
): TagOpenInfo | null {
  const textBefore = html.slice(0, styleStartIdx);
  const stack: TagOpenInfo[] = [];

  const tagRegex = createHtmlTagRegex();
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(textBefore)) !== null) {
    const fullTag = match[0];
    if (
      fullTag.startsWith("<!--") ||
      fullTag.startsWith("<?xml") ||
      /^<!doctype\b/i.test(fullTag) ||
      /^<(?:script|style)\b/i.test(fullTag)
    ) {
      continue;
    }

    const closingTag = match[1];
    const openingTag = match[2];
    const isSelfClosing = match[4] === "/";

    if (closingTag) {
      const lower = closingTag.toLowerCase();
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag.toLowerCase() === lower) {
          stack.splice(s);
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
          depth: stack.length + 1,
        });
      }
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Injects a class name into an HTML element opening tag.
 */
export function addClassToOpenTag(openTag: string, newClass: string): string {
  const classMatch = openTag.match(/class=(["'])(.*?)\1/i);
  if (classMatch) {
    const quote = classMatch[1];
    const existingClasses = classMatch[2].trim();
    if (existingClasses.split(/\s+/).includes(newClass)) {
      return openTag;
    }
    const updated = existingClasses ? `${existingClasses} ${newClass}` : newClass;
    return openTag.replace(classMatch[0], () => `class=${quote}${updated}${quote}`);
  }

  if (openTag.endsWith("/>")) {
    return openTag.slice(0, -2).trimEnd() + ` class="${newClass}"/>`;
  }
  return openTag.slice(0, -1).trimEnd() + ` class="${newClass}">`;
}
