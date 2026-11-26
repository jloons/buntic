import { relative } from "node:path";
import { getErrorMessage } from "../utils/logger.ts";

export interface TemplateErrorLocation {
  filePath?: string;
  line?: number;
  column?: number;
  endColumn?: number;
  source?: string;
}

export interface TemplateErrorOptions {
  message: string;
  location?: TemplateErrorLocation;
  projectRoot?: string;
  resolvedTarget?: string;
  hint?: string;
  cause?: unknown;
}

/**
 * Formats an absolute file path cleanly relative to `projectRoot` when inside it.
 */
export function formatTemplatePath(filePath: string, projectRoot?: string): string {
  if (!filePath) return "";
  if (projectRoot) {
    const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..")) {
      return rel;
    }
  }
  return filePath.replace(/\\/g, "/");
}

/**
 * Converts a 0-based character offset in `source` into 1-based `{ line, column }`.
 */
export function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lastNewline = -1;

  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }

  return {
    line,
    column: clamped - lastNewline,
  };
}

/**
 * Renders a compiler-style code frame highlighting `line` and underlining `column..endColumn`.
 */
export function formatCodeFrame(
  source: string,
  line: number,
  column = 1,
  endColumn?: number,
  contextLines = 2
): string {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0) return "";

  const targetLine = Math.max(1, Math.min(line, lines.length));
  const startLine = Math.max(1, targetLine - contextLines);
  const endLine = Math.min(lines.length, targetLine + contextLines);
  const gutterWidth = String(endLine).length;

  const output: string[] = [];

  for (let i = startLine; i <= endLine; i++) {
    const lineText = lines[i - 1] ?? "";
    const marker = i === targetLine ? ">" : " ";
    const numStr = String(i).padStart(gutterWidth, " ");
    output.push(`  ${marker} ${numStr} | ${lineText}`);

    if (i === targetLine) {
      const colStart = Math.max(1, column);
      const rawPrefix = lineText.slice(0, colStart - 1);
      // Preserve tabs so carets align properly in both terminals and browsers
      const caretPrefix = rawPrefix.replace(/[^\t]/g, " ");
      const maxRemaining = Math.max(1, lineText.length - (colStart - 1));
      const requestedSpan = endColumn && endColumn > colStart ? endColumn - colStart : 1;
      const caretCount = Math.max(1, Math.min(requestedSpan, maxRemaining));
      const blankNum = " ".repeat(gutterWidth);
      output.push(`    ${blankNum} | ${caretPrefix}${"^".repeat(caretCount)}`);
    }
  }

  return output.join("\n");
}

/**
 * Locates a template snippet inside the original template source (falling back to
 * `fallbackHtml` + `fallbackOffset` when rendering inline/virtual templates).
 */
export function findSnippetLocation(options: {
  source?: string;
  snippet: string;
  openTag?: string;
  fallbackHtml?: string;
  fallbackOffset?: number;
  filePath?: string;
}): TemplateErrorLocation {
  const { source, snippet, openTag, fallbackHtml, fallbackOffset, filePath } = options;

  const highlightTarget = openTag || snippet;
  const firstLineLength = Math.max(1, highlightTarget.split(/\r?\n/)[0].length);

  if (source) {
    let idx = snippet ? source.indexOf(snippet) : -1;
    if (idx === -1 && openTag) {
      idx = source.indexOf(openTag);
    }
    if (idx !== -1) {
      const { line, column } = offsetToLineColumn(source, idx);
      return {
        filePath,
        line,
        column,
        endColumn: column + firstLineLength,
        source,
      };
    }
  }

  if (fallbackHtml) {
    let idx =
      fallbackOffset !== undefined && fallbackOffset >= 0
        ? fallbackOffset
        : snippet
          ? fallbackHtml.indexOf(snippet)
          : -1;
    if (idx === -1 && openTag) {
      idx = fallbackHtml.indexOf(openTag);
    }
    if (idx !== -1) {
      const { line, column } = offsetToLineColumn(fallbackHtml, idx);
      return {
        filePath,
        line,
        column,
        endColumn: column + firstLineLength,
        source: fallbackHtml,
      };
    }
  }

  return { filePath };
}

/**
 * Structured template error with source file, line/column, highlighted code frame,
 * resolved target path, underlying cause, and actionable hint.
 */
export class BunticTemplateError extends Error {
  public readonly summary: string;
  public readonly filePath?: string;
  public readonly line?: number;
  public readonly column?: number;
  public readonly endColumn?: number;
  public readonly codeFrame?: string;
  public readonly resolvedTarget?: string;
  public readonly causeMessage?: string;
  public readonly hint?: string;

  constructor(options: TemplateErrorOptions) {
    const { message, location, projectRoot, resolvedTarget, hint, cause } = options;

    const displayFile = location?.filePath
      ? formatTemplatePath(location.filePath, projectRoot)
      : undefined;
    const displayResolved = resolvedTarget
      ? formatTemplatePath(resolvedTarget, projectRoot)
      : undefined;
    const causeMsg = cause !== undefined ? getErrorMessage(cause) : undefined;
    const codeFrame =
      location?.source && location.line
        ? formatCodeFrame(location.source, location.line, location.column, location.endColumn)
        : undefined;

    const parts: string[] = [message];

    if (displayFile) {
      const coords = location?.line
        ? `:${location.line}${location.column ? `:${location.column}` : ""}`
        : "";
      parts.push(`  File:     ${displayFile}${coords}`);
    } else if (location?.line) {
      const colPart = location.column ? `, column ${location.column}` : "";
      parts.push(`  Location: line ${location.line}${colPart}`);
    }

    if (displayResolved) {
      parts.push(`  Resolved: ${displayResolved}`);
    }

    if (causeMsg) {
      parts.push(`  Cause:    ${causeMsg}`);
    }

    if (codeFrame) {
      parts.push("");
      parts.push(codeFrame);
    }

    if (hint) {
      const formattedHint = hint.split("\n").join("\n        ");
      parts.push("");
      parts.push(`  Hint: ${formattedHint}`);
    }

    super(parts.join("\n"));
    this.name = "BunticTemplateError";
    this.summary = message;
    this.filePath = displayFile;
    this.line = location?.line;
    this.column = location?.column;
    this.endColumn = location?.endColumn;
    this.codeFrame = codeFrame;
    this.resolvedTarget = displayResolved;
    this.causeMessage = causeMsg;
    this.hint = hint;
  }
}
