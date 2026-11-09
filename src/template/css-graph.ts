import { basename, dirname, extname, resolve, relative, join } from "node:path";
import { VirtualFileSystem } from "./vfs.ts";
import { pascalToKebab, kebabToPascal } from "./web-components.ts";

export interface CssNode {
  filePath: string;
  relativeToRoot: string;
  imports: string[];
  importedBy: Set<string>;
  isSiblingRoot: boolean;
  claimedBySibling?: string;
}

export interface GlobalRootResult {
  root: string | null;
  relativeRoot: string | null;
  conflicts: string[];
  hasCycle: boolean;
}

const LOCAL_IMPORT_REGEX = /@import\s+(?:url\(['"]?|['"])([^'")]+)['"]?\)?\s*;?/gi;

export class CssDependencyGraph {
  public rootDir: string;
  private nodes: Map<string, CssNode> = new Map();
  private siblingRoots: Set<string> = new Set();
  private globalRootResult: GlobalRootResult | null = null;
  private isAnalyzed: boolean = false;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  public invalidate(): void {
    this.nodes.clear();
    this.siblingRoots.clear();
    this.globalRootResult = null;
    this.isAnalyzed = false;
  }

  /**
   * Scans and builds the complete CSS dependency graph across the project.
   */
  public async analyze(vfs: VirtualFileSystem): Promise<void> {
    if (this.isAnalyzed) return;
    this.invalidate();

    const allFiles = vfs.getAllFiles();
    const publicDir = join(this.rootDir, "public");

    // 1. Collect all project .css files, excluding public/ and external/build dirs
    const cssFiles: string[] = [];
    for (const file of allFiles) {
      if (!file.endsWith(".css")) continue;
      // Exclude public/ directory (static assets served verbatim)
      if (file.startsWith(publicDir)) continue;
      cssFiles.push(file);
    }

    // 2. Identify Sibling Roots and create nodes
    for (const cssPath of cssFiles) {
      const isSibling = this.checkIsSiblingRoot(cssPath, vfs);
      if (isSibling) {
        this.siblingRoots.add(cssPath);
      }

      this.nodes.set(cssPath, {
        filePath: cssPath,
        relativeToRoot: relative(this.rootDir, cssPath).replace(/\\/g, "/"),
        imports: [],
        importedBy: new Set(),
        isSiblingRoot: isSibling,
      });
    }

    // 3. Parse local @import statements for each CSS file
    for (const cssPath of cssFiles) {
      const node = this.nodes.get(cssPath)!;
      let content = "";
      try {
        content = await vfs.readText(cssPath);
      } catch {
        content = await Bun.file(cssPath).text();
      }

      const imports = this.extractLocalImports(content, cssPath, vfs);
      node.imports = imports;

      for (const imported of imports) {
        const importedNode = this.nodes.get(imported);
        if (importedNode) {
          importedNode.importedBy.add(cssPath);
        }
      }
    }

    // 4. Claim subtrees for Sibling Roots
    for (const siblingRoot of this.siblingRoots) {
      const queue = [...this.nodes.get(siblingRoot)!.imports];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const node = this.nodes.get(current);
        if (node) {
          if (!node.isSiblingRoot) {
            node.claimedBySibling = siblingRoot;
          }
          queue.push(...node.imports);
        }
      }
    }

    // 5. Determine Global Root from remaining candidate files
    this.globalRootResult = this.calculateGlobalRoot();
    this.isAnalyzed = true;
  }

  /**
   * Returns the computed global CSS root result.
   */
  public getGlobalRoot(): GlobalRootResult {
    return (
      this.globalRootResult || {
        root: null,
        relativeRoot: null,
        conflicts: [],
        hasCycle: false,
      }
    );
  }

  /**
   * Flattens a CSS file by resolving all local @import statements recursively in topological order.
   * Keeps external @imports at the top.
   */
  public async flattenCss(
    entryFilePath: string,
    vfs: VirtualFileSystem,
    visited: Set<string> = new Set()
  ): Promise<string> {
    const absPath = resolve(entryFilePath);
    if (visited.has(absPath)) return "";
    visited.add(absPath);

    let rawCss = "";
    try {
      rawCss = await vfs.readText(absPath);
    } catch {
      rawCss = await Bun.file(absPath).text();
    }

    const externalImports: string[] = [];
    const dir = dirname(absPath);

    // Replace local @imports with recursively flattened contents
    let flattened = rawCss.replace(
      /@import\s+(?:url\(['"]?|['"])([^'")]+)['"]?\)?\s*;?/gi,
      (match, href: string) => {
        const trimmed = href.trim();
        if (
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://") ||
          trimmed.startsWith("//")
        ) {
          externalImports.push(match.trim());
          return "";
        }

        const candidate = trimmed.startsWith("/")
          ? join(this.rootDir, trimmed.slice(1))
          : resolve(dir, trimmed);

        let resolvedTarget = candidate;
        if (!vfs.hasFile(resolvedTarget) && vfs.hasFile(`${candidate}.css`)) {
          resolvedTarget = `${candidate}.css`;
        }

        // Return a placeholder to be replaced asynchronously below
        return `/* __BUST_IMPORT__:${resolvedTarget} */`;
      }
    );

    // Process all placeholders
    const placeholderRegex = /\/\* __BUST_IMPORT__:(.*?) \*\//g;
    let match: RegExpExecArray | null;
    const placeholders: Array<{ full: string; path: string }> = [];

    while ((match = placeholderRegex.exec(flattened)) !== null) {
      placeholders.push({ full: match[0], path: match[1] });
    }

    for (const item of placeholders) {
      if (vfs.hasFile(item.path)) {
        const childCss = await this.flattenCss(item.path, vfs, visited);
        flattened = flattened.replace(item.full, childCss.trim());
      } else {
        flattened = flattened.replace(item.full, "");
      }
    }

    const header = externalImports.length > 0 ? `${externalImports.join("\n")}\n\n` : "";
    return `${header}${flattened.trim()}`;
  }

  /**
   * Checks whether a CSS file is a sibling of an .html or .ts/.js file in the same directory.
   */
  public checkIsSiblingRoot(cssPath: string, vfs: VirtualFileSystem): boolean {
    const dir = dirname(cssPath);
    const rawBase = basename(cssPath, ".css");

    // Check same base name
    const extensions = [".html", ".ts", ".js", ".tsx", ".jsx"];
    for (const ext of extensions) {
      if (vfs.hasFile(join(dir, `${rawBase}${ext}`))) {
        return true;
      }
    }

    // If kebab-case (e.g. counter-button.css), check PascalCase (CounterButton.ts/html)
    if (rawBase.includes("-")) {
      const pascal = kebabToPascal(rawBase);
      for (const ext of extensions) {
        if (vfs.hasFile(join(dir, `${pascal}${ext}`))) {
          return true;
        }
      }
    }

    // If PascalCase (e.g. CounterButton.css), check kebab-case (counter-button.ts/html)
    if (/^[A-Z][a-zA-Z0-9]+$/.test(rawBase)) {
      const kebab = pascalToKebab(rawBase);
      for (const ext of extensions) {
        if (vfs.hasFile(join(dir, `${kebab}${ext}`))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extracts local relative @import paths from CSS content.
   */
  private extractLocalImports(
    content: string,
    currentCssPath: string,
    vfs: VirtualFileSystem
  ): string[] {
    const imports: string[] = [];
    const dir = dirname(currentCssPath);
    const regex = new RegExp(LOCAL_IMPORT_REGEX);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const href = match[1].trim();
      // Skip external URLs
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("//")
      ) {
        continue;
      }

      let candidate = href.startsWith("/")
        ? join(this.rootDir, href.slice(1))
        : resolve(dir, href);

      if (!vfs.hasFile(candidate) && vfs.hasFile(`${candidate}.css`)) {
        candidate = `${candidate}.css`;
      }

      if (vfs.hasFile(candidate)) {
        imports.push(candidate);
      }
    }

    return imports;
  }

  /**
   * Calculates the global root among candidate files.
   */
  private calculateGlobalRoot(): GlobalRootResult {
    const candidatePaths = new Set<string>();

    for (const [path, node] of this.nodes.entries()) {
      if (!node.isSiblingRoot && !node.claimedBySibling) {
        candidatePaths.add(path);
      }
    }

    if (candidatePaths.size === 0) {
      return { root: null, relativeRoot: null, conflicts: [], hasCycle: false };
    }

    // Calculate in-degree among candidate nodes only
    const zeroInDegree: string[] = [];

    for (const path of candidatePaths) {
      const node = this.nodes.get(path)!;
      let inDegree = 0;
      for (const importedBy of node.importedBy) {
        if (candidatePaths.has(importedBy)) {
          inDegree++;
        }
      }

      if (inDegree === 0) {
        zeroInDegree.push(path);
      }
    }

    if (zeroInDegree.length === 1) {
      const root = zeroInDegree[0];
      return {
        root,
        relativeRoot: relative(this.rootDir, root).replace(/\\/g, "/"),
        conflicts: [],
        hasCycle: false,
      };
    }

    if (zeroInDegree.length > 1) {
      return {
        root: null,
        relativeRoot: null,
        conflicts: zeroInDegree,
        hasCycle: false,
      };
    }

    // zeroInDegree.length === 0 but candidatePaths.size > 0 -> circular dependency
    return {
      root: null,
      relativeRoot: null,
      conflicts: [],
      hasCycle: true,
    };
  }
}
