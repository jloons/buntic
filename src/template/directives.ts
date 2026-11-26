/**
 * Template directive evaluators:
 * - Decision blocks: <if>, <unless>, <match>/<case>/<else>/<none>/<default>
 * - Safe expressions in is="..." and conditional attribute if="..."
 * - Strict typed value & range matchers (string, number, boolean, min, max)
 * - Variable interpolation {{ var ?? "fallback" }}
 */

import { parseHtmlAttributes } from "../utils/html.ts";
import { findTopLevelBlocks, splitDirectSubBlocks, type TemplateBlock } from "./block-scanner.ts";
import { BunticTemplateError, findSnippetLocation } from "./errors.ts";
import {
  evaluateExpression,
  ExpressionSyntaxError,
  getNestedValue,
  isTruthy,
} from "./expressions.ts";

export { evaluateExpression, ExpressionSyntaxError, getNestedValue, isTruthy };

export interface DirectiveDiagnosticContext {
  filePath?: string;
  source?: string;
  projectRoot?: string;
}

interface ParsedValueMatchers {
  hasMatcher: boolean;
  stringVal?: string;
  numberVal?: number;
  booleanVal?: boolean;
  minVal?: number;
  maxVal?: number;
}

const NESTED_DIRECTIVE_SCOPES = ["if", "unless", "match", "each"];

function buildError(options: {
  message: string;
  hint?: string;
  cause?: unknown;
  snippet: string;
  openTag?: string;
  fallbackHtml: string;
  fallbackOffset?: number;
  diag?: DirectiveDiagnosticContext;
}): BunticTemplateError {
  const { message, hint, cause, snippet, openTag, fallbackHtml, fallbackOffset, diag } = options;
  const location = findSnippetLocation({
    source: diag?.source,
    snippet,
    openTag,
    fallbackHtml,
    fallbackOffset,
    filePath: diag?.filePath,
  });
  return new BunticTemplateError({
    message,
    location,
    projectRoot: diag?.projectRoot,
    cause,
    hint,
  });
}

function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses and strictly validates typed/range matcher attributes (`string`, `number`, `boolean`,
 * `min`, `max`) on `<if>`, `<unless>`, or `<case>`.
 */
function parseAndValidateMatchers(
  attrs: Record<string, string>,
  block: TemplateBlock,
  fallbackHtml: string,
  diag?: DirectiveDiagnosticContext
): ParsedValueMatchers {
  const hasString = "string" in attrs;
  const hasNumber = "number" in attrs;
  const hasBoolean = "boolean" in attrs;
  const hasMin = "min" in attrs;
  const hasMax = "max" in attrs;
  const hasRange = hasMin || hasMax;

  const activeCategories = [hasString, hasNumber, hasBoolean, hasRange].filter(Boolean).length;
  if (activeCategories === 0) {
    return { hasMatcher: false };
  }

  if (activeCategories > 1) {
    throw buildError({
      message: `[Buntic] Conflicting value matcher attributes on <${block.tag}>.`,
      hint: `Use a single matcher type ("string", "number", "boolean") or a numeric range ("min" / "max"), not a mix of incompatible attributes.`,
      snippet: block.fullMatch,
      openTag: block.openTag,
      fallbackHtml,
      fallbackOffset: block.start,
      diag,
    });
  }

  if (hasString) {
    return { hasMatcher: true, stringVal: attrs.string };
  }

  if (hasNumber) {
    const parsed = parseFiniteNumber(attrs.number);
    if (parsed === null) {
      throw buildError({
        message: `[Buntic] Invalid numeric literal "${attrs.number}" in number="..." attribute on <${block.tag}>.`,
        hint: `The "number" attribute expects a finite numeric literal (e.g. number="0" or number="42"). To compare against another variable, use an expression in is="..." (e.g. is="age === config.target").`,
        snippet: block.fullMatch,
        openTag: block.openTag,
        fallbackHtml,
        fallbackOffset: block.start,
        diag,
      });
    }
    return { hasMatcher: true, numberVal: parsed };
  }

  if (hasBoolean) {
    const raw = attrs.boolean.trim();
    if (raw !== "true" && raw !== "false") {
      throw buildError({
        message: `[Buntic] Invalid boolean literal "${attrs.boolean}" in boolean="..." attribute on <${block.tag}>.`,
        hint: `The "boolean" attribute only accepts "true" or "false".`,
        snippet: block.fullMatch,
        openTag: block.openTag,
        fallbackHtml,
        fallbackOffset: block.start,
        diag,
      });
    }
    return { hasMatcher: true, booleanVal: raw === "true" };
  }

  let minVal: number | undefined;
  let maxVal: number | undefined;

  if (hasMin) {
    const parsed = parseFiniteNumber(attrs.min);
    if (parsed === null) {
      throw buildError({
        message: `[Buntic] Invalid numeric literal "${attrs.min}" in min="..." attribute on <${block.tag}>.`,
        hint: `The "min" attribute expects a finite numeric literal (e.g. min="18"). To compare against another variable, use is="age >= config.minAge".`,
        snippet: block.fullMatch,
        openTag: block.openTag,
        fallbackHtml,
        fallbackOffset: block.start,
        diag,
      });
    }
    minVal = parsed;
  }

  if (hasMax) {
    const parsed = parseFiniteNumber(attrs.max);
    if (parsed === null) {
      throw buildError({
        message: `[Buntic] Invalid numeric literal "${attrs.max}" in max="..." attribute on <${block.tag}>.`,
        hint: `The "max" attribute expects a finite numeric literal (e.g. max="30"). To compare against another variable, use is="age <= config.maxAge".`,
        snippet: block.fullMatch,
        openTag: block.openTag,
        fallbackHtml,
        fallbackOffset: block.start,
        diag,
      });
    }
    maxVal = parsed;
  }

  if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
    throw buildError({
      message: `[Buntic] Invalid range on <${block.tag}>: min="${minVal}" cannot be greater than max="${maxVal}".`,
      hint: `Ensure min <= max (e.g. min="${maxVal}" max="${minVal}").`,
      snippet: block.fullMatch,
      openTag: block.openTag,
      fallbackHtml,
      fallbackOffset: block.start,
      diag,
    });
  }

  return { hasMatcher: true, minVal, maxVal };
}

/**
 * Strictly checks `val` against parsed typed/range matchers.
 * Rejects values whose runtime JavaScript type does not match the expected type.
 */
function matchesValue(val: unknown, matchers: ParsedValueMatchers): boolean {
  if (matchers.stringVal !== undefined) {
    return typeof val === "string" && val === matchers.stringVal;
  }
  if (matchers.numberVal !== undefined) {
    return typeof val === "number" && !Number.isNaN(val) && val === matchers.numberVal;
  }
  if (matchers.booleanVal !== undefined) {
    return typeof val === "boolean" && val === matchers.booleanVal;
  }
  if (matchers.minVal !== undefined || matchers.maxVal !== undefined) {
    if (typeof val !== "number" || Number.isNaN(val)) {
      return false;
    }
    if (matchers.minVal !== undefined && val < matchers.minVal) return false;
    if (matchers.maxVal !== undefined && val > matchers.maxVal) return false;
    return true;
  }
  return false;
}

function evalDirectiveExpr(
  expr: string,
  context: Record<string, unknown>,
  snippet: string,
  openTag: string,
  fallbackHtml: string,
  fallbackOffset: number | undefined,
  diag?: DirectiveDiagnosticContext
): unknown {
  try {
    return evaluateExpression(expr, context);
  } catch (err: unknown) {
    const hint = err instanceof ExpressionSyntaxError ? err.hint : undefined;
    throw buildError({
      message: `[Buntic] Invalid condition expression "${expr}".`,
      cause: err,
      hint:
        hint ||
        `Check expression syntax (supported: paths like "a.b", literals, !, ===, !==, ==, !=, <, <=, >, >=, &&, ||, parentheses).`,
      snippet,
      openTag,
      fallbackHtml,
      fallbackOffset,
      diag,
    });
  }
}

function evaluateDecisionBlock(
  block: TemplateBlock,
  context: Record<string, unknown>,
  fallbackHtml: string,
  diag?: DirectiveDiagnosticContext
): string {
  const attrs = parseHtmlAttributes(block.attrString, "");

  if (!attrs.is || !attrs.is.trim()) {
    throw buildError({
      message: `[Buntic] <${block.tag}> tag requires an "is" attribute.`,
      hint: `Example: <${block.tag} is="condition">...</${block.tag}>.`,
      snippet: block.fullMatch,
      openTag: block.openTag,
      fallbackHtml,
      fallbackOffset: block.start,
      diag,
    });
  }

  if (block.tag === "if") {
    const matchers = parseAndValidateMatchers(attrs, block, fallbackHtml, diag);
    const val = evalDirectiveExpr(
      attrs.is,
      context,
      block.fullMatch,
      block.openTag,
      fallbackHtml,
      block.start,
      diag
    );
    const passed = matchers.hasMatcher ? matchesValue(val, matchers) : isTruthy(val);

    const { body, subBlocks } = splitDirectSubBlocks(
      block.inner,
      ["else"],
      NESTED_DIRECTIVE_SCOPES
    );
    const elseBlock = subBlocks[0];
    const chosen = passed ? body.trim() : (elseBlock ? elseBlock.inner.trim() : "");
    return chosen ? resolveConditionals(chosen, context, diag) : "";
  }

  if (block.tag === "unless") {
    const matchers = parseAndValidateMatchers(attrs, block, fallbackHtml, diag);
    const val = evalDirectiveExpr(
      attrs.is,
      context,
      block.fullMatch,
      block.openTag,
      fallbackHtml,
      block.start,
      diag
    );
    const condition = matchers.hasMatcher ? matchesValue(val, matchers) : isTruthy(val);
    const chosen = !condition ? block.inner.trim() : "";
    return chosen ? resolveConditionals(chosen, context, diag) : "";
  }

  // <match is="...">
  const { subBlocks } = splitDirectSubBlocks(
    block.inner,
    ["case", "else", "none", "default"],
    NESTED_DIRECTIVE_SCOPES
  );

  const cases: Array<{ block: TemplateBlock; matchers: ParsedValueMatchers }> = [];
  let elseBlock: TemplateBlock | undefined;
  let noneBlock: TemplateBlock | undefined;
  let defaultBlock: TemplateBlock | undefined;

  // Validate all <case> directives upfront so template errors are always caught
  for (const sub of subBlocks) {
    if (sub.tag === "case") {
      const caseAttrs = parseHtmlAttributes(sub.attrString, "");
      const matchers = parseAndValidateMatchers(caseAttrs, sub, block.inner, diag);
      if (!matchers.hasMatcher) {
        throw buildError({
          message: `[Buntic] <case> tag inside <match> requires a value matcher attribute.`,
          hint: `Specify one of: string="...", number="...", boolean="true|false", or min="..." / max="...".`,
          snippet: sub.fullMatch,
          openTag: sub.openTag,
          fallbackHtml: block.inner,
          fallbackOffset: sub.start,
          diag,
        });
      }
      cases.push({ block: sub, matchers });
    } else if (sub.tag === "else" && !elseBlock) {
      elseBlock = sub;
    } else if (sub.tag === "none" && !noneBlock) {
      noneBlock = sub;
    } else if (sub.tag === "default" && !defaultBlock) {
      defaultBlock = sub;
    }
  }

  const val = evalDirectiveExpr(
    attrs.is,
    context,
    block.fullMatch,
    block.openTag,
    fallbackHtml,
    block.start,
    diag
  );

  let chosen = "";
  if (val === undefined || val === null) {
    const fallback = elseBlock ?? defaultBlock;
    chosen = fallback ? fallback.inner.trim() : "";
  } else {
    let matched: TemplateBlock | undefined;
    for (const c of cases) {
      if (matchesValue(val, c.matchers)) {
        matched = c.block;
        break;
      }
    }
    if (matched) {
      chosen = matched.inner.trim();
    } else {
      const fallback = noneBlock ?? defaultBlock;
      chosen = fallback ? fallback.inner.trim() : "";
    }
  }

  return chosen ? resolveConditionals(chosen, context, diag) : "";
}

/**
 * Resolves all decision directives in `html`:
 * 1. Block directives: `<if>`, `<unless>`, `<match>` (with balanced nesting)
 * 2. Self-closing elements with conditional attribute: `<tag ... if="expr" ... />`
 * 3. Paired elements with conditional attribute: `<tag ... if="expr" ...>...</tag>`
 */
export function resolveConditionals(
  html: string,
  context: Record<string, unknown>,
  diag?: DirectiveDiagnosticContext
): string {
  // 1. Balanced top-level block directives: <if>, <unless>, <match>
  const topBlocks = findTopLevelBlocks(html, ["if", "unless", "match"]);
  let res = html;

  if (topBlocks.length > 0) {
    let rebuilt = "";
    let cursor = 0;
    for (const block of topBlocks) {
      rebuilt += html.slice(cursor, block.start);
      rebuilt += evaluateDecisionBlock(block, context, html, diag);
      cursor = block.end;
    }
    rebuilt += html.slice(cursor);
    res = rebuilt;
  }

  // 2. Self-closing elements with conditional `if="..."` attribute
  res = res.replace(
    /<([a-zA-Z0-9_-]+)((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*?)?)\s+if=(?:"([^"]+)"|'([^']+)')((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?)\s*\/>/gi,
    (fullMatch, tag, before, exprDouble, exprSingle, after, offset) => {
      const expr = (exprDouble ?? exprSingle ?? "").trim();
      const val = evalDirectiveExpr(expr, context, fullMatch, fullMatch, res, offset, diag);
      if (!isTruthy(val)) return "";
      const attrs = `${before ?? ""} ${after ?? ""}`.trim().replace(/\s+/g, " ");
      return attrs ? `<${tag} ${attrs} />` : `<${tag} />`;
    }
  );

  // 3. Paired elements with conditional `if="..."` attribute
  res = res.replace(
    /<([a-zA-Z0-9_-]+)((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*?)?)\s+if=(?:"([^"]+)"|'([^']+)')((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?)>([\s\S]*?)<\/\1>/gi,
    (fullMatch, tag, before, exprDouble, exprSingle, after, content, offset) => {
      const expr = (exprDouble ?? exprSingle ?? "").trim();
      const closeLen = tag.length + 3; // </tag>
      const openTag = fullMatch.slice(0, fullMatch.length - content.length - closeLen);
      const val = evalDirectiveExpr(expr, context, fullMatch, openTag, res, offset, diag);
      if (!isTruthy(val)) return "";
      const attrs = `${before ?? ""} ${after ?? ""}`.trim().replace(/\s+/g, " ");
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
