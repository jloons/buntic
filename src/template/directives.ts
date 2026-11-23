/**
 * Pure template directive evaluators: conditionals (<if> / if="...") and {{ var ?? "fallback" }} interpolation.
 */

export function isTruthy(val: unknown): boolean {
  if (val === undefined || val === null || val === false || val === "") return false;
  if (Array.isArray(val) && val.length === 0) return false;
  if (typeof val === "number" && isNaN(val)) return false;
  return true;
}

export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Resolves conditionals:
 * 1. <if is="expr"> ... [ <else> ... </else> ] </if>
 * 2. Self-closing elements: <tag ... if="expr" ... />
 * 3. Paired elements: <tag ... if="expr" ...>...</tag>
 */
export function resolveConditionals(html: string, context: Record<string, unknown>): string {
  // 1. <if is="expr"> ... [ <else> ... </else> ] </if>
  let res = html.replace(/<if\s+is=["']([^"']+)["'][^>]*>([\s\S]*?)<\/if>/gi, (_match, expr, inner) => {
    const val = getNestedValue(context, expr.trim());
    let thenContent = inner;
    let elseContent = "";
    const elseMatch = inner.match(/([\s\S]*?)<else>([\s\S]*?)<\/else>/i);
    if (elseMatch) {
      thenContent = elseMatch[1];
      elseContent = elseMatch[2];
    }
    return isTruthy(val) ? thenContent.trim() : elseContent.trim();
  });

  // 2. Self-closing: <tag ... if="expr" ... />
  res = res.replace(
    /<([a-zA-Z0-9_-]+)\s+([^>]*?)if=["']([^"']+)["']([^>]*?)\s*\/>/gi,
    (_m, tag, before, expr, after) => {
      const val = getNestedValue(context, expr.trim());
      if (!isTruthy(val)) return "";
      const attrs = `${before} ${after}`.trim().replace(/\s+/g, " ");
      return attrs ? `<${tag} ${attrs} />` : `<${tag} />`;
    }
  );

  // 3. Paired tags: <tag ... if="expr" ...>...</tag>
  res = res.replace(
    /<([a-zA-Z0-9_-]+)\s+([^>]*?)if=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/\1>/gi,
    (_m, tag, before, expr, after, content) => {
      const val = getNestedValue(context, expr.trim());
      if (!isTruthy(val)) return "";
      const attrs = `${before} ${after}`.trim().replace(/\s+/g, " ");
      return attrs ? `<${tag} ${attrs}>${content}</${tag}>` : `<${tag}>${content}</${tag}>`;
    }
  );

  return res;
}

export function interpolateTemplate(html: string, context: Record<string, unknown>): string {
  return html.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)(?:\s*\?\?\s*["']([^"']*)["'])?\s*\}\}/g,
    (match, key, fallback) => {
      const trimmed = key.trim();
      const val = getNestedValue(context, trimmed);
      if (val !== undefined && val !== null) return String(val);
      if (fallback !== undefined) return fallback;
      return match;
    }
  );
}
