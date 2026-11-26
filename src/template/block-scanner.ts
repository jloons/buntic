/**
 * Balanced, quote-aware HTML directive block scanner.
 * Handles nested blocks (<if>, <unless>, <match>, <each>), operators like ">" inside
 * quoted attributes (e.g. <if is="age > 18">), HTML comments, and raw <script>/<style> blocks.
 */

export interface TemplateBlock {
  tag: string;
  fullMatch: string;
  openTag: string;
  attrString: string;
  inner: string;
  start: number;
  end: number;
}

export interface SplitSubBlocksResult {
  body: string;
  subBlocks: TemplateBlock[];
}

interface OpenFrame {
  tag: string;
  isTarget: boolean;
  start: number;
  openTagEnd: number;
  openTag: string;
  attrString: string;
}

function isTagNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 95 // _
  );
}

function isAsciiLetter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Scans forward from `start` (the index right after the tag name) to find the closing `>`
 * of an HTML opening tag, respecting single- and double-quoted attribute values.
 */
function findTagClose(html: string, start: number): number {
  const len = html.length;
  let quote: string | null = null;

  for (let i = start; i < len; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }

  return -1;
}

/**
 * Skips a raw text element (`<script>...</script>` or `<style>...</style>`) starting at `<`.
 */
function skipRawElement(html: string, start: number, tagName: string): number {
  const openEnd = findTagClose(html, start + 1 + tagName.length);
  if (openEnd === -1) return html.length;

  const closePattern = new RegExp(`<\\/${tagName}\\s*>`, "i");
  const rest = html.slice(openEnd + 1);
  const closeMatch = closePattern.exec(rest);
  if (!closeMatch) return html.length;

  return openEnd + 1 + closeMatch.index + closeMatch[0].length;
}

/**
 * Core balanced scanner: extracts top-level blocks matching `targetTags`, while tracking
 * nested occurrences of `targetTags` and `nestedScopeTags` so inner tags are never confused
 * with outer closing or sibling tags.
 */
function scanBlocks(
  html: string,
  targetTags: ReadonlySet<string>,
  nestedScopeTags: ReadonlySet<string>
): TemplateBlock[] {
  const results: TemplateBlock[] = [];
  const stack: OpenFrame[] = [];
  const len = html.length;
  let i = 0;

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    i = lt;

    // 1. Skip HTML comments
    if (html.startsWith("<!--", i)) {
      const commentEnd = html.indexOf("-->", i + 4);
      i = commentEnd === -1 ? len : commentEnd + 3;
      continue;
    }

    // 2. Skip doctype / XML prologues
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const closeIdx = html.indexOf(">", i + 2);
      i = closeIdx === -1 ? len : closeIdx + 1;
      continue;
    }

    // 3. Closing tag: </tagName>
    if (html[i + 1] === "/") {
      let j = i + 2;
      if (j < len && isAsciiLetter(html[j])) {
        const nameStart = j;
        while (j < len && isTagNameChar(html[j])) j++;
        const closeTag = html.slice(nameStart, j).toLowerCase();
        while (j < len && /\s/.test(html[j])) j++;
        if (j < len && html[j] === ">") {
          if (stack.length > 0 && stack[stack.length - 1].tag === closeTag) {
            const frame = stack.pop()!;
            if (stack.length === 0 && frame.isTarget) {
              const end = j + 1;
              results.push({
                tag: frame.tag,
                fullMatch: html.slice(frame.start, end),
                openTag: frame.openTag,
                attrString: frame.attrString,
                inner: html.slice(frame.openTagEnd, i),
                start: frame.start,
                end,
              });
            }
          }
          i = j + 1;
          continue;
        }
      }
      i += 2;
      continue;
    }

    // 4. Opening tag: <tagName ...>
    if (i + 1 < len && isAsciiLetter(html[i + 1])) {
      let j = i + 1;
      const nameStart = j;
      while (j < len && isTagNameChar(html[j])) j++;
      const openTagName = html.slice(nameStart, j).toLowerCase();

      // Must be followed by whitespace, '>' or '/' to be a valid tag name boundary
      if (j < len && !/[\s>/]/.test(html[j])) {
        i = j;
        continue;
      }

      // Skip raw <script> and <style> contents completely
      if (openTagName === "script" || openTagName === "style") {
        i = skipRawElement(html, i, openTagName);
        continue;
      }

      const closeIdx = findTagClose(html, j);
      if (closeIdx === -1) {
        i = j;
        continue;
      }

      const rawAttrs = html.slice(j, closeIdx);
      const trimmedAttrs = rawAttrs.trimEnd();
      const isSelfClosing = trimmedAttrs.endsWith("/");
      const attrString = isSelfClosing ? trimmedAttrs.slice(0, -1).trim() : rawAttrs.trim();

      if (!isSelfClosing) {
        if (stack.length === 0) {
          if (targetTags.has(openTagName)) {
            stack.push({
              tag: openTagName,
              isTarget: true,
              start: i,
              openTagEnd: closeIdx + 1,
              openTag: html.slice(i, closeIdx + 1),
              attrString,
            });
          } else if (nestedScopeTags.has(openTagName)) {
            stack.push({
              tag: openTagName,
              isTarget: false,
              start: i,
              openTagEnd: closeIdx + 1,
              openTag: html.slice(i, closeIdx + 1),
              attrString,
            });
          }
        } else {
          // Track nested occurrences of the enclosing tag or nested directive scopes
          const topTag = stack[stack.length - 1].tag;
          if (openTagName === topTag || nestedScopeTags.has(openTagName)) {
            stack.push({
              tag: openTagName,
              isTarget: false,
              start: i,
              openTagEnd: closeIdx + 1,
              openTag: html.slice(i, closeIdx + 1),
              attrString,
            });
          }
        }
      }

      i = closeIdx + 1;
      continue;
    }

    i++;
  }

  return results;
}

/**
 * Finds all top-level balanced blocks for the given directive tag names.
 */
export function findTopLevelBlocks(html: string, tagNames: string[]): TemplateBlock[] {
  const targetSet = new Set(tagNames.map((t) => t.toLowerCase()));
  return scanBlocks(html, targetSet, targetSet);
}

/**
 * Extracts direct (depth-0) child sub-blocks (`allowedTags`) from `inner` while ignoring
 * identically named tags nested inside `nestedScopeTags` (e.g. an `<else>` inside a nested `<if>`).
 * Returns the remaining body text (with extracted sub-blocks removed) and the ordered sub-blocks.
 */
export function splitDirectSubBlocks(
  inner: string,
  allowedTags: string[],
  nestedScopeTags: string[]
): SplitSubBlocksResult {
  const targetSet = new Set(allowedTags.map((t) => t.toLowerCase()));
  const scopeSet = new Set(nestedScopeTags.map((t) => t.toLowerCase()));
  const subBlocks = scanBlocks(inner, targetSet, scopeSet);

  if (subBlocks.length === 0) {
    return { body: inner, subBlocks: [] };
  }

  let body = "";
  let cursor = 0;
  for (const block of subBlocks) {
    body += inner.slice(cursor, block.start);
    cursor = block.end;
  }
  body += inner.slice(cursor);

  return { body, subBlocks };
}
