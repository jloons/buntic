import { join, resolve, dirname } from "node:path";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { WebComponentRegistry } from "./web-components.ts";

/**
 * Checks whether a path or filename should be ignored by VFS and the dev file watcher.
 * Filters out build/system folders and editor temporary/swap/backup files (Vim, Neovim, Emacs, JetBrains, macOS).
 */
export function isIgnoredPath(filePathOrName: string): boolean {
  const normalized = filePathOrName.replace(/\\/g, "/");
  const segments = normalized.split("/");

  for (const seg of segments) {
    if (
      seg === "node_modules" ||
      seg === ".git" ||
      seg === ".agents" ||
      seg === "dist" ||
      seg.startsWith(".buntic")
    ) {
      return true;
    }
  }

  const base = segments[segments.length - 1] || "";
  if (!base) return false;

  // Vim / Emacs / Nano backup & undo files (e.g. header.css~, .header.css.un~)
  if (base.endsWith("~")) return true;

  // Vim swap files (e.g. .header.css.swp, .header.css.swo, .header.css.swx)
  if (/^\..*\.sw[a-z]+$/i.test(base) || /\.(swp|swo|swn|swx|swpx)$/i.test(base)) {
    return true;
  }

  // Vim write-check probe files (4913, 5036, 5159, 5282)
  if (/^(4913|5036|5159|5282)$/.test(base)) return true;

  // Emacs lock and auto-save files (e.g. .#header.css, #header.css#)
  if (base.startsWith(".#") || (base.startsWith("#") && base.endsWith("#"))) {
    return true;
  }

  // Common atomic write / IDE temporary files and OS metadata
  if (
    base.endsWith(".tmp") ||
    base.endsWith(".__jb_tmp__") ||
    base.endsWith(".__jb_old__") ||
    base === ".DS_Store" ||
    base === "Thumbs.db"
  ) {
    return true;
  }

  return false;
}

export class VirtualFileSystem {
  public root: string;
  public registry: WebComponentRegistry = new WebComponentRegistry();
  private knownFiles: Set<string> = new Set();
  private knownDirs: Set<string> = new Set();
  private pathCache: Map<string, string> = new Map();
  private contentCache: Map<string, string> = new Map();
  private jsonCache: Map<string, any> = new Map();

  constructor(root: string) {
    this.root = resolve(root);
    this.scan(this.root);
  }

  /**
   * Fast in-memory scan of the project directory.
   * Excludes common heavy or generated directories.
   */
  public scan(dir = this.root): void {
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (isIgnoredPath(entry)) {
          continue;
        }

        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            this.knownDirs.add(fullPath);
            this.scan(fullPath);
          } else if (stat.isFile()) {
            this.knownFiles.add(fullPath);
            if (/\.(ts|js|tsx|jsx)$/.test(fullPath)) {
              try {
                const content = readFileSync(fullPath, "utf-8");
                this.registry.registerFile(fullPath, content);
              } catch {
                this.registry.registerFile(fullPath);
              }
            }
          }
        } catch {
          // Ignore unreadable files or broken symlinks
        }
      }
    } catch {
      // Ignore unreadable directory
    }
  }

  /**
   * O(1) in-memory check to see if a file exists without touching disk.
   */
  public hasFile(path: string): boolean {
    const absPath = resolve(path);
    if (this.knownFiles.has(absPath)) return true;
    // Fallback to disk if file was created after scan
    if (existsSync(absPath) && !statSync(absPath).isDirectory()) {
      this.knownFiles.add(absPath);
      return true;
    }
    return false;
  }

  /**
   * Resolves a referenced template path using in-memory index and cached resolutions.
   */
  public resolvePath(rawSrc: string, currentFile: string, defaultDir: string): string {
    const cacheKey = `${currentFile}::${rawSrc}::${defaultDir}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached) return cached;

    const src = rawSrc;
    const srcWithHtml = src.endsWith(".html") ? src : `${src}.html`;
    const candidates: string[] = [];

    // 1. Explicit relative path (./ or ../)
    if (src.startsWith("./") || src.startsWith("../")) {
      const fromDir = currentFile ? dirname(resolve(currentFile)) : this.root;
      candidates.push(resolve(fromDir, src));
      candidates.push(resolve(fromDir, srcWithHtml));
    }

    // 2. Root-relative (/layouts/main.html or /components/card.html)
    if (src.startsWith("/")) {
      const clean = src.slice(1);
      candidates.push(resolve(this.root, clean));
      candidates.push(resolve(this.root, srcWithHtml.slice(1)));
      candidates.push(resolve(this.root, "src", clean));
      candidates.push(resolve(this.root, "src", srcWithHtml.slice(1)));
    }

    // 3. Current file directory implicit relative
    if (currentFile && !src.startsWith("/")) {
      const fromDir = dirname(resolve(currentFile));
      candidates.push(resolve(fromDir, src));
      candidates.push(resolve(fromDir, srcWithHtml));
    }

    // 4. Default convention directory (e.g. layouts/ or components/)
    candidates.push(resolve(defaultDir, src));
    candidates.push(resolve(defaultDir, srcWithHtml));

    // 5. Project root directly
    candidates.push(resolve(this.root, src));
    candidates.push(resolve(this.root, srcWithHtml));

    for (const cand of candidates) {
      if (this.hasFile(cand)) {
        this.pathCache.set(cacheKey, cand);
        return cand;
      }
    }

    const fallback = candidates[0] || resolve(defaultDir, srcWithHtml);
    this.pathCache.set(cacheKey, fallback);
    return fallback;
  }

  /**
   * Reads a text file using in-memory content cache.
   */
  public async readText(path: string): Promise<string> {
    const absPath = resolve(path);
    const cached = this.contentCache.get(absPath);
    if (cached !== undefined) return cached;

    const content = await Bun.file(absPath).text();
    this.contentCache.set(absPath, content);
    return content;
  }

  /**
   * Reads a JSON file using in-memory parsed JSON cache.
   */
  public async readJson(path: string): Promise<any> {
    const absPath = resolve(path);
    const cached = this.jsonCache.get(absPath);
    if (cached !== undefined) return cached;

    const content = await Bun.file(absPath).json();
    this.jsonCache.set(absPath, content);
    return content;
  }

  /**
   * Returns all known indexed file paths in the workspace.
   */
  public getAllFiles(): string[] {
    return Array.from(this.knownFiles);
  }

  /**
   * Returns all known files located inside a given subfolder (e.g. data/)
   */
  public getFilesInDirectory(subDir: string): string[] {
    const absSubDir = resolve(subDir);
    const results: string[] = [];
    for (const file of this.knownFiles) {
      if (dirname(resolve(file)) === absSubDir) {
        results.push(file);
      }
    }
    return results;
  }

  /**
   * Invalidates cached entries when a file is modified, added, or deleted.
   */
  public invalidateFile(path?: string): void {
    if (!path) {
      this.clear();
      return;
    }

    const absPath = resolve(path);
    this.contentCache.delete(absPath);
    this.jsonCache.delete(absPath);
    this.pathCache.clear();

    // If a backup file (e.g. file.css~) was referenced, also invalidate the target file
    if (absPath.endsWith("~")) {
      const targetPath = absPath.slice(0, -1);
      this.contentCache.delete(targetPath);
      this.jsonCache.delete(targetPath);
    }

    if (isIgnoredPath(absPath)) {
      return;
    }

    const isScript = /\.(ts|js|tsx|jsx)$/.test(absPath);
    if (isScript) {
      this.registry.unregisterFile(absPath);
    }

    if (existsSync(absPath)) {
      try {
        const stat = statSync(absPath);
        if (stat.isDirectory()) {
          this.knownDirs.add(absPath);
          this.scan(absPath);
        } else if (stat.isFile()) {
          this.knownFiles.add(absPath);
          if (isScript) {
            try {
              const content = readFileSync(absPath, "utf-8");
              this.registry.registerFile(absPath, content);
            } catch {
              this.registry.registerFile(absPath);
            }
          }
        }
      } catch {
        // Ignore transient stat error during atomic save
      }
    } else {
      this.knownFiles.delete(absPath);
      this.knownDirs.delete(absPath);
    }
  }

  /**
   * Clears in-memory content, JSON, and path resolution caches without losing indexed files.
   */
  public clearContentCache(): void {
    this.contentCache.clear();
    this.jsonCache.clear();
    this.pathCache.clear();
  }

  /**
   * Clears all caches and rescans the project directory.
   */
  public clear(): void {
    this.knownFiles.clear();
    this.knownDirs.clear();
    this.pathCache.clear();
    this.contentCache.clear();
    this.jsonCache.clear();
    this.registry = new WebComponentRegistry();
    this.scan(this.root);
  }
}
