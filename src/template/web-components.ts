import { basename, extname, dirname, join } from "node:path";

export const RESERVED_W3C_TAGS = new Set([
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

/**
 * Converts a PascalCase string to kebab-case.
 * e.g. "CounterButton" -> "counter-button"
 */
export function pascalToKebab(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Converts a kebab-case string to PascalCase.
 * e.g. "counter-button" -> "CounterButton"
 */
export function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Derives the expected custom element tag name from a file path.
 * The filename must be in hyphenated kebab-case (e.g. "counter-button.ts")
 * or PascalCase with at least two words (e.g. "CounterButton.ts").
 * Returns null if the filename does not adhere to Custom Element naming.
 */
export function filenameToTagName(filePath: string): string | null {
  const ext = extname(filePath);
  const rawName = basename(filePath, ext);

  if (rawName.includes("-")) {
    return rawName.toLowerCase();
  }

  if (/^[A-Z][a-zA-Z0-9]+$/.test(rawName)) {
    const kebab = pascalToKebab(rawName);
    if (kebab.includes("-")) {
      return kebab;
    }
  }

  return null;
}

export class WebComponentRegistry {
  // Map tag to canonical defining file path
  private tagToFile: Map<string, string> = new Map();
  // Map file path to the single tag it registered
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
   * Registers a JavaScript/TypeScript file for a Web Component under strict 1:1 convention:
   * 1. The filename must match the custom element tag name (kebab-case or PascalCase).
   * 2. Only 1 custom element may be defined per file.
   */
  public registerFile(filePath: string, content?: string): string[] {
    // Clean up previous registrations for this file first
    this.unregisterFile(filePath);

    const expectedTag = filenameToTagName(filePath);
    if (!expectedTag) {
      if (content && /(?:customElements\.define|@customElement)\s*\(\s*["']([a-z0-9-]+)["']/i.test(content)) {
        console.warn(
          `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Web Component file "${filePath}" does not match naming convention (must be hyphenated kebab-case like "my-button.ts" or PascalCase like "MyButton.ts"). Registration skipped.`
        );
      }
      return [];
    }

    const validation = this.validateTagName(expectedTag);
    if (!validation.valid) {
      console.warn(
        `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Skipping invalid Custom Element tag "${expectedTag}" in ${filePath}: ${validation.reason}`
      );
      return [];
    }

    if (content) {
      // 1. Detect any customElements.define("tag-name", ...) or @customElement("tag-name")
      const defineRegex = /(?:customElements\.define|@customElement)\s*\(\s*["']([a-z0-9-]+)["']/gi;
      const declaredTags = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = defineRegex.exec(content)) !== null) {
        declaredTags.add(match[1].toLowerCase());
      }

      // Enforce: only 1 custom element per file
      if (declaredTags.size > 1) {
        console.warn(
          `\x1b[33m⚠ [Bustatic Warning]\x1b[0m File "${filePath}" declares multiple Custom Elements (${Array.from(declaredTags).map((t) => `<${t}>`).join(", ")}). Bustatic strictly enforces 1 Web Component per file. File skipped.`
        );
        return [];
      }

      // Enforce: declared tag must match filename
      if (declaredTags.size === 1) {
        const declaredTag = Array.from(declaredTags)[0];
        if (declaredTag !== expectedTag) {
          console.warn(
            `\x1b[33m⚠ [Bustatic Warning]\x1b[0m Tag "<${declaredTag}>" in "${filePath}" does not match filename. Expected tag "<${expectedTag}>" for file "${basename(filePath)}". Registration skipped.`
          );
          return [];
        }
      }
    }

    // Check for collision with another file
    const existingFile = this.tagToFile.get(expectedTag);
    if (existingFile && existingFile !== filePath) {
      const conflictFiles = this.conflicts.get(expectedTag) || [existingFile];
      if (!conflictFiles.includes(filePath)) {
        conflictFiles.push(filePath);
      }
      this.conflicts.set(expectedTag, conflictFiles);
      console.warn(
        `\x1b[33m⚠ [Bustatic Collision Warning]\x1b[0m Tag "<${expectedTag}>" in ${filePath} conflicts with definition in ${existingFile}.`
      );
      return [];
    }

    this.tagToFile.set(expectedTag, filePath);
    this.fileToTags.set(filePath, new Set([expectedTag]));
    return [expectedTag];
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
   * Returns all tags registered by a specific file.
   */
  public getTagsForFile(filePath: string): string[] {
    const set = this.fileToTags.get(filePath);
    return set ? Array.from(set) : [];
  }

  /**
   * Returns all registered tags.
   */
  public getAllRegisteredTags(): string[] {
    return Array.from(this.tagToFile.keys());
  }
}

export interface ComponentTriad {
  tag: string;
  scriptPath?: string;
  htmlPath?: string;
  cssPath?: string;
}

/**
 * Given a Web Component script path (e.g. components/counter-button.ts or components/CounterButton.ts),
 * locates any co-located sibling HTML template and CSS stylesheet.
 */
export function findTriadForScript(
  scriptPath: string,
  existsFn: (p: string) => boolean
): ComponentTriad | null {
  const tag = filenameToTagName(scriptPath);
  if (!tag) return null;

  const dir = dirname(scriptPath);
  const ext = extname(scriptPath);
  const rawBase = basename(scriptPath, ext);

  const kebabBase = tag;
  const pascalBase = kebabToPascal(tag);
  const candidateNames = Array.from(new Set([rawBase, kebabBase, pascalBase]));

  let htmlPath: string | undefined;
  for (const name of candidateNames) {
    const candidate = join(dir, `${name}.html`);
    if (existsFn(candidate)) {
      htmlPath = candidate;
      break;
    }
  }

  let cssPath: string | undefined;
  for (const name of candidateNames) {
    const candidate = join(dir, `${name}.css`);
    if (existsFn(candidate)) {
      cssPath = candidate;
      break;
    }
  }

  return {
    tag,
    scriptPath,
    htmlPath,
    cssPath,
  };
}
