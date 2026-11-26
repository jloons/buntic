import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "../src/config.ts";
import { TemplateEngine } from "../src/template/engine.ts";
import { evaluateExpression, resolveConditionals } from "../src/template/directives.ts";
import { BunticTemplateError } from "../src/template/errors.ts";

describe("Advanced Control-Flow Directives & Safe Expressions", () => {
  const tempDirs: string[] = [];

  function makeProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "buntic-directives-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "src/pages"), { recursive: true });
    mkdirSync(join(dir, "src/layouts"), { recursive: true });
    mkdirSync(join(dir, "src/components"), { recursive: true });
    mkdirSync(join(dir, "src/data"), { recursive: true });
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  describe("Safe expression evaluator (is='...')", () => {
    test("evaluates nested paths, .length, negation, comparisons, logical ops, and parentheses", () => {
      const ctx = {
        age: 22,
        config: { allowed_age: 18 },
        position: { x: 15, y: -3 },
        items: ["a", "b"],
        empty: [],
        name: "Buntic",
        props: { product: { inStock: false } },
        role: "editor",
      };

      expect(evaluateExpression("position.x", ctx)).toBe(15);
      expect(evaluateExpression("position.y === -3", ctx)).toBe(true);
      expect(evaluateExpression("items.length === 2", ctx)).toBe(true);
      expect(evaluateExpression("name.length > 3", ctx)).toBe(true);
      expect(evaluateExpression("!props.product.inStock", ctx)).toBe(true);
      expect(evaluateExpression("!empty", ctx)).toBe(true);
      expect(evaluateExpression("age >= 18 && age <= 30", ctx)).toBe(true);
      expect(evaluateExpression("age >= config.allowed_age", ctx)).toBe(true);
      expect(evaluateExpression("(role === 'admin' || role === 'editor') && age >= 18", ctx)).toBe(
        true
      );
      expect(evaluateExpression("role === 'admin' && age >= 18", ctx)).toBe(false);
    });

    test("blocks prototype property traversal", () => {
      const ctx = { user: { name: "Ada" } };
      expect(evaluateExpression("user.__proto__", ctx)).toBeUndefined();
      expect(evaluateExpression("user.constructor", ctx)).toBeUndefined();
      expect(evaluateExpression("user.toString", ctx)).toBeUndefined();
    });

    test("renders <if is='...'> with '>' inside quotes and nested <if>/<else>", () => {
      const html = `
        <if is="age > 18">
          <if is="role === 'admin'">
            <span>Admin Adult</span>
            <else>
              <span>Regular Adult</span>
            </else>
          </if>
          <else>
            <span>Minor</span>
          </else>
        </if>
      `;

      expect(resolveConditionals(html, { age: 25, role: "user" }).trim()).toBe(
        "<span>Regular Adult</span>"
      );
      expect(resolveConditionals(html, { age: 25, role: "admin" }).trim()).toBe(
        "<span>Admin Adult</span>"
      );
      expect(resolveConditionals(html, { age: 15, role: "admin" }).trim()).toBe(
        "<span>Minor</span>"
      );
    });

    test("throws BunticTemplateError with exact file and line on expression syntax error", () => {
      const src = '<div>\n  <if is="{{ age == 0 }}">\n    <p>Zero</p>\n  </if>\n</div>';
      let caught: unknown;
      try {
        resolveConditionals(src, { age: 0 }, { filePath: "src/pages/test.html", source: src });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BunticTemplateError);
      const err = caught as BunticTemplateError;
      expect(err.filePath).toBe("src/pages/test.html");
      expect(err.line).toBe(2);
      expect(err.hint).toContain('Do not wrap expressions in "{{ }}"');
    });
  });

  describe("Typed value & range matchers (string, number, boolean, min, max)", () => {
    test("enforces strict runtime type checking on <if>", () => {
      const tplZero = '<if is="age" number="0">Zero</if>';
      expect(resolveConditionals(tplZero, { age: 0 })).toBe("Zero");
      expect(resolveConditionals(tplZero, { age: "0" })).toBe("");
      expect(resolveConditionals(tplZero, { age: false })).toBe("");

      const tplRange = '<if is="age" min="18" max="30">Young Adult</if>';
      expect(resolveConditionals(tplRange, { age: 18 })).toBe("Young Adult");
      expect(resolveConditionals(tplRange, { age: 30 })).toBe("Young Adult");
      expect(resolveConditionals(tplRange, { age: 17 })).toBe("");
      expect(resolveConditionals(tplRange, { age: 31 })).toBe("");
      expect(resolveConditionals(tplRange, { age: "22" })).toBe("");

      const tplMinOnly = '<if is="score" min="100">High</if>';
      expect(resolveConditionals(tplMinOnly, { score: 100 })).toBe("High");
      expect(resolveConditionals(tplMinOnly, { score: 99 })).toBe("");

      const tplMaxOnly = '<if is="temp" max="0">Freezing</if>';
      expect(resolveConditionals(tplMaxOnly, { temp: -5 })).toBe("Freezing");
      expect(resolveConditionals(tplMaxOnly, { temp: 1 })).toBe("");

      const tplStr = '<if is="role" string="admin">Admin</if>';
      expect(resolveConditionals(tplStr, { role: "admin" })).toBe("Admin");
      expect(resolveConditionals(tplStr, { role: "user" })).toBe("");

      const tplBool = '<if is="active" boolean="false">Inactive</if>';
      expect(resolveConditionals(tplBool, { active: false })).toBe("Inactive");
      expect(resolveConditionals(tplBool, { active: "false" })).toBe("");
      expect(resolveConditionals(tplBool, { active: 0 })).toBe("");
    });

    test("preserves HTML min/max attributes on regular elements using conditional if='...'", () => {
      const html = '<input type="number" min="18" max="99" if="showAge" />';
      expect(resolveConditionals(html, { showAge: true })).toBe(
        '<input type="number" min="18" max="99" />'
      );
      expect(resolveConditionals(html, { showAge: false })).toBe("");

      const paired = '<span class="count" if="count > 0">Has items</span>';
      expect(resolveConditionals(paired, { count: 3 })).toBe(
        '<span class="count">Has items</span>'
      );
      expect(resolveConditionals(paired, { count: 0 })).toBe("");

      // Must not falsely match attributes ending with "if" like data-if
      const untouched = '<div data-if="false">Keep me</div>';
      expect(resolveConditionals(untouched, {})).toBe(untouched);
    });

    test("throws BunticTemplateError for invalid literals, inverted ranges, and conflicting matchers", () => {
      expect(() => resolveConditionals('<if is="age" number="abc">X</if>', { age: 1 })).toThrow(
        BunticTemplateError
      );
      expect(() =>
        resolveConditionals('<if is="age" min="30" max="18">X</if>', { age: 20 })
      ).toThrow(BunticTemplateError);
      expect(() =>
        resolveConditionals('<if is="ok" boolean="yes">X</if>', { ok: true })
      ).toThrow(BunticTemplateError);
      expect(() =>
        resolveConditionals('<if is="age" string="10" number="10">X</if>', { age: 10 })
      ).toThrow(BunticTemplateError);
    });
  });

  describe("<unless> directive", () => {
    test("renders body when condition is falsy or typed matcher does not match", () => {
      expect(
        resolveConditionals('<unless is="props.product.inStock"><span>Agotado</span></unless>', {
          props: { product: { inStock: false } },
        })
      ).toBe("<span>Agotado</span>");

      expect(
        resolveConditionals('<unless is="props.product.inStock"><span>Agotado</span></unless>', {
          props: { product: { inStock: true } },
        })
      ).toBe("");

      expect(
        resolveConditionals('<unless is="role" string="admin">Restricted</unless>', {
          role: "guest",
        })
      ).toBe("Restricted");

      expect(
        resolveConditionals('<unless is="role" string="admin">Restricted</unless>', {
          role: "admin",
        })
      ).toBe("");
    });
  });

  describe("<match> / <case> / <else> / <none> / <default>", () => {
    const ageMatch = `
      <match is="age">
        <case number="0">Newborn</case>
        <case min="1" max="17">Minor</case>
        <case min="18" max="64">Adult</case>
        <case min="18" max="64">OverlapShouldNotRun</case>
        <none>OutOfRange</none>
        <else>UndefinedAge</else>
      </match>
    `;

    test("stops at the first matching <case> (no fallthrough)", () => {
      expect(resolveConditionals(ageMatch, { age: 0 }).trim()).toBe("Newborn");
      expect(resolveConditionals(ageMatch, { age: 10 }).trim()).toBe("Minor");
      expect(resolveConditionals(ageMatch, { age: 30 }).trim()).toBe("Adult");
    });

    test("distinguishes <none> (defined, no case matched) vs <else> (undefined/null)", () => {
      expect(resolveConditionals(ageMatch, { age: 99 }).trim()).toBe("OutOfRange");
      expect(resolveConditionals(ageMatch, { age: "25" }).trim()).toBe("OutOfRange");
      expect(resolveConditionals(ageMatch, { age: undefined }).trim()).toBe("UndefinedAge");
      expect(resolveConditionals(ageMatch, { age: null }).trim()).toBe("UndefinedAge");
      expect(resolveConditionals(ageMatch, {}).trim()).toBe("UndefinedAge");
    });

    test("uses <default> as universal fallback for both <else> and <none>", () => {
      const withDefault = `
        <match is="role">
          <case string="admin">Admin</case>
          <default>Guest</default>
        </match>
      `;
      expect(resolveConditionals(withDefault, { role: "admin" }).trim()).toBe("Admin");
      expect(resolveConditionals(withDefault, { role: "editor" }).trim()).toBe("Guest");
      expect(resolveConditionals(withDefault, { role: undefined }).trim()).toBe("Guest");
      expect(resolveConditionals(withDefault, { role: null }).trim()).toBe("Guest");

      // Specific <else> wins over <default> when undefined, while <default> still handles <none>
      const mixed = `
        <match is="role">
          <case string="admin">Admin</case>
          <else>NoRole</else>
          <default>OtherRole</default>
        </match>
      `;
      expect(resolveConditionals(mixed, { role: undefined }).trim()).toBe("NoRole");
      expect(resolveConditionals(mixed, { role: "editor" }).trim()).toBe("OtherRole");
    });

    test("outputs empty string when no <case> matches and no fallback exists", () => {
      const noFallback = '<match is="role"><case string="admin">Admin</case></match>';
      expect(resolveConditionals(noFallback, { role: "guest" })).toBe("");
      expect(resolveConditionals(noFallback, {})).toBe("");
    });

    test("validates <case> attributes upfront even if an earlier <case> matches", () => {
      const badMatch = `
        <match is="age">
          <case number="10">Ten</case>
          <case min="abc">Broken</case>
        </match>
      `;
      expect(() => resolveConditionals(badMatch, { age: 10 })).toThrow(BunticTemplateError);
    });
  });

  describe("<each> fallbacks (<none>, <else>, <default>) and nesting", () => {
    test("renders <none> for empty array and <else> for undefined/null source", async () => {
      const root = makeProject();
      const config = await resolveConfig(root);
      const engine = new TemplateEngine(config);

      const template = `
        <each in="workers">
          <li>{{ name }}</li>
          <none><p>Empty list</p></none>
          <else><p>Missing list</p></else>
        </each>
      `;

      const withItems = await engine.renderPage(template, "", {
        workers: [{ name: "Ana" }, { name: "Luis" }],
      });
      expect(withItems).toContain("<li>Ana</li>");
      expect(withItems).toContain("<li>Luis</li>");
      expect(withItems).not.toContain("Empty list");
      expect(withItems).not.toContain("Missing list");

      const withEmpty = await engine.renderPage(template, "", { workers: [] });
      expect(withEmpty.trim()).toBe("<p>Empty list</p>");

      const withUndefined = await engine.renderPage(template, "", {});
      expect(withUndefined.trim()).toBe("<p>Missing list</p>");

      const withNull = await engine.renderPage(template, "", { workers: null });
      expect(withNull.trim()).toBe("<p>Missing list</p>");
    });

    test("renders <default> as universal fallback for both empty and undefined/null in <each>", async () => {
      const root = makeProject();
      const config = await resolveConfig(root);
      const engine = new TemplateEngine(config);

      const template = `
        <each in="items">
          <span>{{ item }}</span>
          <default><p>Fallback for {{ section }}</p></default>
        </each>
      `;

      const emptyRes = await engine.renderPage(template, "", { items: [], section: "Catalog" });
      expect(emptyRes.trim()).toBe("<p>Fallback for Catalog</p>");

      const undefRes = await engine.renderPage(template, "", { section: "Catalog" });
      expect(undefRes.trim()).toBe("<p>Fallback for Catalog</p>");
    });

    test("does not confuse <else> inside a nested <if> with <each>'s own <else>", async () => {
      const root = makeProject();
      const config = await resolveConfig(root);
      const engine = new TemplateEngine(config);

      const template = `
        <each in="workers">
          <if is="active">
            <span>{{ name }}: ON</span>
            <else>
              <span>{{ name }}: OFF</span>
            </else>
          </if>
          <none><p>No workers</p></none>
        </each>
      `;

      const rendered = await engine.renderPage(template, "", {
        workers: [
          { name: "Ana", active: true },
          { name: "Luis", active: false },
        ],
      });
      expect(rendered).toContain("<span>Ana: ON</span>");
      expect(rendered).toContain("<span>Luis: OFF</span>");
      expect(rendered).not.toContain("No workers");
    });

    test("still throws BunticTemplateError when <each in> is undefined and has no <else>/<default>", async () => {
      const root = makeProject();
      const config = await resolveConfig(root);
      const engine = new TemplateEngine(config);

      await expect(
        engine.renderPage('<each in="typo"><p>{{item}}</p><none>Empty</none></each>', "", {})
      ).rejects.toThrow(BunticTemplateError);
    });

    test("renders components and <match> inside <each> and inside fallbacks", async () => {
      const root = makeProject();
      writeFileSync(
        join(root, "src/components/empty-state.html"),
        '<div class="empty">{{ label }}</div>',
        "utf8"
      );
      const config = await resolveConfig(root);
      const engine = new TemplateEngine(config);

      const template = `
        <each in="users">
          <match is="role">
            <case string="admin"><b>{{ name }}</b></case>
            <default><span>{{ name }}</span></default>
          </match>
          <none>
            <component src="empty-state.html" label="No users found" />
          </none>
        </each>
      `;

      const populated = await engine.renderPage(template, "", {
        users: [
          { name: "Ada", role: "admin" },
          { name: "Bob", role: "viewer" },
        ],
      });
      expect(populated).toContain("<b>Ada</b>");
      expect(populated).toContain("<span>Bob</span>");

      const empty = await engine.renderPage(template, "", { users: [] });
      expect(empty.trim()).toBe('<div class="empty">No users found</div>');
    });
  });

  describe("Catalog example compatibility (<if is='!props.product.inStock'>)", () => {
    test("correctly evaluates negated stock check from examples/catalog", () => {
      const snippet = `
        <if is="props.product.inStock">
          <span class="in-stock">En Stock</span>
        </if>
        <if is="!props.product.inStock">
          <span class="out-of-stock">Agotado</span>
        </if>
      `;

      const inStockHtml = resolveConditionals(snippet, { props: { product: { inStock: true } } });
      expect(inStockHtml).toContain("En Stock");
      expect(inStockHtml).not.toContain("Agotado");

      const outOfStockHtml = resolveConditionals(snippet, {
        props: { product: { inStock: false } },
      });
      expect(outOfStockHtml).toContain("Agotado");
      expect(outOfStockHtml).not.toContain("En Stock");
    });
  });
});
