/**
 * Zero-dependency, eval-free expression parser and evaluator for Buntic template directives.
 * Supports nested paths (e.g. `position.x`, `items.length`), literals (numbers, strings,
 * booleans, null, undefined), unary (`!`, `-`), relational (`<`, `<=`, `>`, `>=`),
 * equality (`===`, `!==`, `==`, `!=`), logical (`&&`, `||`), and parentheses.
 */

const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class ExpressionSyntaxError extends Error {
  public readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ExpressionSyntaxError";
    this.hint = hint;
  }
}

export function isTruthy(val: unknown): boolean {
  if (val === undefined || val === null || val === false || val === "") return false;
  if (Array.isArray(val) && val.length === 0) return false;
  if (typeof val === "number" && Number.isNaN(val)) return false;
  return true;
}

export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;

  for (const part of parts) {
    if (!part || FORBIDDEN_PATH_KEYS.has(part)) return undefined;
    if (cur == null) return undefined;

    if (typeof cur === "string") {
      if (part === "length") {
        cur = cur.length;
        continue;
      }
      return undefined;
    }

    if (typeof cur !== "object") return undefined;

    if (Array.isArray(cur)) {
      if (part === "length") {
        cur = cur.length;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(cur, part)) {
        cur = (cur as unknown as Record<string, unknown>)[part];
        continue;
      }
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(cur, part)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }

  return cur;
}

type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "undefined"
  | "path"
  | "op"
  | "lparen"
  | "rparen"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  numValue?: number;
  boolValue?: boolean;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Disallow {{ }} inside expressions with an actionable hint
    if (ch === "{" && input[i + 1] === "{") {
      throw new ExpressionSyntaxError(
        `Unexpected "{{" in expression "${input}".`,
        `Do not wrap expressions in "{{ }}" inside is="...". Write the expression directly, e.g. is="age >= 18".`
      );
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")", pos: i });
      i++;
      continue;
    }

    // 3-char operators
    const three = input.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three, pos: i });
      i += 3;
      continue;
    }

    // 2-char operators
    const two = input.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }

    // Single '=' helpful error
    if (ch === "=") {
      throw new ExpressionSyntaxError(
        `Unexpected assignment operator "=" at position ${i + 1} in expression "${input}".`,
        `Use "==" or "===" to compare values.`
      );
    }

    // Single '&' or '|' helpful error
    if (ch === "&" || ch === "|") {
      throw new ExpressionSyntaxError(
        `Unexpected operator "${ch}" at position ${i + 1} in expression "${input}".`,
        `Use "${ch}${ch}" for logical ${ch === "&" ? "AND" : "OR"}.`
      );
    }

    // 1-char operators
    if (ch === "<" || ch === ">" || ch === "!" || ch === "-") {
      tokens.push({ type: "op", value: ch, pos: i });
      i++;
      continue;
    }

    // String literals ('...' or "...")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let str = "";
      let closed = false;
      while (i < len) {
        const c = input[i];
        if (c === "\\" && i + 1 < len) {
          const next = input[i + 1];
          if (next === "n") str += "\n";
          else if (next === "t") str += "\t";
          else if (next === "r") str += "\r";
          else str += next;
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        str += c;
        i++;
      }
      if (!closed) {
        throw new ExpressionSyntaxError(
          `Unterminated string literal starting at position ${start + 1} in expression "${input}".`
        );
      }
      tokens.push({ type: "string", value: str, pos: start });
      continue;
    }

    // Number literals (e.g. 0, 18, 3.14)
    if (/[0-9]/.test(ch)) {
      const start = i;
      let hasDot = false;
      while (i < len) {
        const c = input[i];
        if (/[0-9]/.test(c)) {
          i++;
        } else if (c === "." && !hasDot && i + 1 < len && /[0-9]/.test(input[i + 1])) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }
      const raw = input.slice(start, i);
      tokens.push({ type: "number", value: raw, numValue: Number(raw), pos: start });
      continue;
    }

    // Identifiers, keywords, and dotted paths (e.g. props.product.inStock, items.0.name)
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_$.]/.test(input[i])) {
        i++;
      }
      const raw = input.slice(start, i);
      if (raw.startsWith(".") || raw.endsWith(".") || raw.includes("..")) {
        throw new ExpressionSyntaxError(
          `Invalid property path "${raw}" in expression "${input}".`
        );
      }
      if (raw === "true" || raw === "false") {
        tokens.push({ type: "boolean", value: raw, boolValue: raw === "true", pos: start });
      } else if (raw === "null") {
        tokens.push({ type: "null", value: raw, pos: start });
      } else if (raw === "undefined") {
        tokens.push({ type: "undefined", value: raw, pos: start });
      } else {
        tokens.push({ type: "path", value: raw, pos: start });
      }
      continue;
    }

    throw new ExpressionSyntaxError(
      `Unexpected character "${ch}" at position ${i + 1} in expression "${input}".`
    );
  }

  tokens.push({ type: "eof", value: "", pos: len });
  return tokens;
}

type ExprNode =
  | { kind: "literal"; value: unknown }
  | { kind: "path"; path: string }
  | { kind: "unary"; op: "!" | "-"; operand: ExprNode }
  | { kind: "binary"; op: string; left: ExprNode; right: ExprNode };

class ExpressionParser {
  private tokens: Token[];
  private pos = 0;
  private rawInput: string;

  constructor(tokens: Token[], rawInput: string) {
    this.tokens = tokens;
    this.rawInput = rawInput;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  public parse(): ExprNode {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw new ExpressionSyntaxError(
        `Unexpected token "${trailing.value}" at position ${trailing.pos + 1} in expression "${this.rawInput}".`
      );
    }
    return node;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek().type === "op" && this.peek().value === "||") {
      this.consume();
      const right = this.parseAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality();
    while (this.peek().type === "op" && this.peek().value === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): ExprNode {
    let left = this.parseRelational();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "===" ||
        this.peek().value === "!==" ||
        this.peek().value === "==" ||
        this.peek().value === "!=")
    ) {
      const op = this.consume().value;
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): ExprNode {
    let left = this.parseUnary();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "<" ||
        this.peek().value === "<=" ||
        this.peek().value === ">" ||
        this.peek().value === ">=")
    ) {
      const op = this.consume().value;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const tok = this.peek();
    if (tok.type === "op" && (tok.value === "!" || tok.value === "-")) {
      this.consume();
      const operand = this.parseUnary();
      return { kind: "unary", op: tok.value, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();

    if (tok.type === "number") {
      this.consume();
      return { kind: "literal", value: tok.numValue };
    }
    if (tok.type === "string") {
      this.consume();
      return { kind: "literal", value: tok.value };
    }
    if (tok.type === "boolean") {
      this.consume();
      return { kind: "literal", value: tok.boolValue };
    }
    if (tok.type === "null") {
      this.consume();
      return { kind: "literal", value: null };
    }
    if (tok.type === "undefined") {
      this.consume();
      return { kind: "literal", value: undefined };
    }
    if (tok.type === "path") {
      this.consume();
      return { kind: "path", path: tok.value };
    }
    if (tok.type === "lparen") {
      this.consume();
      const inner = this.parseOr();
      if (this.peek().type !== "rparen") {
        throw new ExpressionSyntaxError(
          `Expected closing ")" in expression "${this.rawInput}".`
        );
      }
      this.consume();
      return inner;
    }

    throw new ExpressionSyntaxError(
      `Unexpected ${tok.type === "eof" ? "end of expression" : `token "${tok.value}"`} in expression "${this.rawInput}".`
    );
  }
}

function evalAst(node: ExprNode, context: Record<string, unknown>): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "path":
      return getNestedValue(context, node.path);
    case "unary": {
      const operand = evalAst(node.operand, context);
      if (node.op === "!") {
        return !isTruthy(operand);
      }
      return -Number(operand);
    }
    case "binary": {
      if (node.op === "||") {
        const left = evalAst(node.left, context);
        return isTruthy(left) ? left : evalAst(node.right, context);
      }
      if (node.op === "&&") {
        const left = evalAst(node.left, context);
        return isTruthy(left) ? evalAst(node.right, context) : left;
      }

      const left = evalAst(node.left, context);
      const right = evalAst(node.right, context);

      switch (node.op) {
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case "==":
          // eslint-disable-next-line eqeqeq
          return left == right;
        case "!=":
          // eslint-disable-next-line eqeqeq
          return left != right;
        case "<":
          return (left as number) < (right as number);
        case "<=":
          return (left as number) <= (right as number);
        case ">":
          return (left as number) > (right as number);
        case ">=":
          return (left as number) >= (right as number);
        default:
          return false;
      }
    }
  }
}

/**
 * Safely parses and evaluates a template expression against `context`.
 */
export function evaluateExpression(expr: string, context: Record<string, unknown>): unknown {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new ExpressionSyntaxError("Condition expression cannot be empty.");
  }
  const tokens = tokenize(trimmed);
  const parser = new ExpressionParser(tokens, trimmed);
  const ast = parser.parse();
  return evalAst(ast, context);
}
