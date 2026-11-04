import { basename, extname } from "node:path";

const RESERVED_W3C_TAGS = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);

export interface ComponentConflict {
  tag: string;
  files: string[];
}

export class WebComponentRegistry {
  // Map tag to canonical defining file path
  private tagToFile: Map<string, string> = new Map();
  // Map file path to all tags it registered
  private fileToTags: Map<string, Set<string>> = new Map();
  // Track conflicts: tag -> array of file paths that tried to register it
  private conflicts: Map<string, string[]> = new Map();
  // Track which tags were actually referenced in HTML pages
  private usedTags: Set<string> = new Set();

  /**
   * Validates if a custom element tag name is compliant with W3C specification.
   */
  public validateTagName(tag: string): { valid: boolean; reason?: string } {
    if (!tag.includes("-")) {
      return { valid: false, reason: `Tag "${tag}" does not contain a hyphen ("-") as required by Custom Elements specification.` };
    }
    if (!/^[a-z]/.test(tag)) {
      return { valid: false, reason: `Tag "${tag}" must start with an ASCII lowercase letter (a-z).` };
    }
    if (RESERVED_W3C_TAGS.has(tag.toLowerCase())) {
      return { valid: false, reason: `Tag "${tag}" is a reserved element name in the W3C specification.` };
    }
    return { valid: true };
  }

  /**
   * Registers a JavaScript/TypeScript file and extracts any declared custom element tags.
   */
  public registerFile(filePath: string, content?: string): string[] {
    // Clean up previous registrations for this file first
    this.unregisterFile(filePath);

    const discoveredTags = new Set<string>();

    if (content) {
      // 1. Detect customElements.define("tag-name", ...) or @customElement("tag-name")
      const defineRegex = /(?:customElements\.define|@customElement)\s*\(\s*["']([a-z0-9-]+)["']/gi;
      let match: RegExpExecArray | null;
      while ((match = defineRegex.exec(content)) !== null) {
        discoveredTags.add(match[1].toLowerCase());
      }
    }

    // 2. Fallback: check filename convention if no explicit define found
    if (discoveredTags.size === 0) {
      const ext = extname(filePath);
      if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") {
        const rawName = basename(filePath, ext);
        // If filename already contains a hyphen (e.g. counter-button.ts)
        if (rawName.includes("-")) {
          discoveredTags.add(rawName.toLowerCase());
        } else if (/^[A-Z][a-zA-Z0-9]+$/.test(rawName)) {
          // If PascalCase (e.g. CounterButton.ts -> counter-button)
          const kebab = rawName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
          if (kebab.includes("-")) {
            discoveredTags.add(kebab);
          }
        }
      }
    }

    const attemptedTags: string[] = [];
    const registered: string[] = [];

    for (const tag of discoveredTags) {
      const validation = this.validateTagName(tag);
      if (!validation.valid) {
        console.warn(`\x1b[33m⚠ [Bustatic Warning]\x1b[0m Skipping invalid Custom Element tag "${tag}" in ${filePath}: ${validation.reason}`);
        continue;
      }

      attemptedTags.push(tag);

      // Check for collision with another file
      const existingFile = this.tagToFile.get(tag);
      if (existingFile && existingFile !== filePath) {
        const conflictFiles = this.conflicts.get(tag) || [existingFile];
        if (!conflictFiles.includes(filePath)) {
          conflictFiles.push(filePath);
        }
        this.conflicts.set(tag, conflictFiles);
        console.warn(
          `\x1b[33m⚠ [Bustatic Collision Warning]\x1b[0m Tag "<${tag}>" in ${filePath} conflicts with definition in ${existingFile}.`
        );
      } else {
        this.tagToFile.set(tag, filePath);
        registered.push(tag);
      }
    }

    if (attemptedTags.length > 0) {
      this.fileToTags.set(filePath, new Set(attemptedTags));
    }

    return registered;
  }

  /**
   * Unregisters a file and cleans up its tags and conflicts.
   */
  public unregisterFile(filePath: string): void {
    const tags = this.fileToTags.get(filePath) || new Set<string>();

    // Also check any conflict that might mention filePath
    for (const [tag, files] of this.conflicts.entries()) {
      if (files.includes(filePath)) {
        tags.add(tag);
      }
    }

    for (const tag of tags) {
      if (this.tagToFile.get(tag) === filePath) {
        this.tagToFile.delete(tag);
      }

      // Clean up conflicts
      const conflictFiles = this.conflicts.get(tag);
      if (conflictFiles) {
        const updated = conflictFiles.filter((f) => f !== filePath);
        if (updated.length <= 1) {
          this.conflicts.delete(tag);
          if (updated.length === 1) {
            this.tagToFile.set(tag, updated[0]);
          }
        } else {
          this.conflicts.set(tag, updated);
        }
      }
    }
    this.fileToTags.delete(filePath);
  }

  /**
   * Returns the file path for a registered tag, if any.
   */
  public findScriptForTag(tag: string): string | undefined {
    return this.tagToFile.get(tag.toLowerCase());
  }

  /**
   * Marks a tag as having been referenced in an HTML document.
   */
  public markTagUsed(tag: string): void {
    this.usedTags.add(tag.toLowerCase());
  }

  /**
   * Clears the set of used tags (e.g. before a new full build).
   */
  public clearUsed(): void {
    this.usedTags.clear();
  }

  /**
   * Returns any detected tag collisions.
   */
  public getConflicts(): ComponentConflict[] {
    const list: ComponentConflict[] = [];
    for (const [tag, files] of this.conflicts.entries()) {
      list.push({ tag, files });
    }
    return list;
  }

  /**
   * Throws an error if any unresolved tag collisions exist.
   */
  public assertNoConflicts(): void {
    const conflicts = this.getConflicts();
    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => `  • Tag "<${c.tag}>" defined in:\n${c.files.map((f) => `      - ${f}`).join("\n")}`)
        .join("\n\n");
      throw new Error(
        `[Bustatic Conflict Error]: Tag collision detected between Web Components:\n${details}\n\n` +
        `👉 Each Custom Element tag must be uniquely defined.`
      );
    }
  }

  /**
   * Returns components that were registered in the project but never used in any page.
   */
  public getUnusedComponents(): Array<{ tag: string; file: string }> {
    const unused: Array<{ tag: string; file: string }> = [];
    for (const [tag, file] of this.tagToFile.entries()) {
      if (!this.usedTags.has(tag)) {
        unused.push({ tag, file });
      }
    }
    return unused;
  }

  /**
   * Returns all registered tags.
   */
  public getAllRegisteredTags(): string[] {
    return Array.from(this.tagToFile.keys());
  }
}
