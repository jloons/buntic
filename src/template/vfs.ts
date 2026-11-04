import { join, resolve, dirname } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";

export class VirtualFileSystem {
  public root: string;
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
        if (
          entry === "node_modules" ||
          entry === ".git" ||
          entry === "dist" ||
          entry.startsWith(".bustatic")
        ) {
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

    if (existsSync(absPath)) {
      this.knownFiles.add(absPath);
    } else {
      this.knownFiles.delete(absPath);
    }
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
    this.scan(this.root);
  }
}
