/**
 * Shared HTML and XML string utilities for Bustatic.
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Parses HTML/XML tag attributes from an attribute string.
 * Handles double-quoted, single-quoted, unquoted, and boolean attributes.
 */
export function parseHtmlAttributes(
  attrString: string,
  booleanDefault = "true"
): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_\-:@]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? booleanDefault;
    attrs[key] = val;
  }

  return attrs;
}

/**
 * Replaces the first occurrence of `search` in `source` literally,
 * avoiding special replacement patterns like `$&`, `$1`, or `$$`.
 */
export function replaceLiteral(
  source: string,
  search: string,
  replacement: string
): string {
  return source.replace(search, () => replacement);
}

/**
 * Injects an HTML snippet right before `</head>`, or falls back to `</body>` / document start/end.
 */
export function injectIntoHead(
  html: string,
  snippet: string,
  fallbackPosition: "prepend" | "append" = "append"
): string {
  if (!snippet.trim()) {
    return html;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, () => `${snippet}\n</head>`);
  }

  if (/<html\b[^>]*>/i.test(html) && fallbackPosition === "prepend") {
    return html.replace(/(<html\b[^>]*>)/i, (match) => `${match}\n<head>\n${snippet}\n</head>`);
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, () => `${snippet}\n</body>`);
  }

  return fallbackPosition === "prepend"
    ? `${snippet}\n${html}`
    : `${html}\n${snippet}`;
}

/**
 * Injects an HTML snippet right before `</body>`, or appends it if no `</body>` tag exists.
 */
export function injectBeforeBodyEnd(html: string, snippet: string): string {
  if (!snippet) {
    return html;
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, () => `${snippet}</body>`);
  }
  return `${html}${snippet}`;
}
