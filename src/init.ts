import { existsSync, mkdirSync, readdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPackageRoot, syncProjectTypes } from "./runtime.ts";

export const AVAILABLE_TEMPLATES = ["blank", "simple"] as const;
export type TemplateName = (typeof AVAILABLE_TEMPLATES)[number];

export interface InitProjectOptions {
  targetDir?: string;
  template?: string;
  includeSkills?: boolean;
  force?: boolean;
}

export interface InitProjectResult {
  targetDir: string;
  template: TemplateName;
  skillsDir: string | null;
  filesCopied: number;
}

function copyTemplateDirectory(srcDir: string, destDir: string): number {
  let count = 0;
  mkdirSync(destDir, { recursive: true });

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "package.json") {
      continue;
    }
    const srcPath = join(srcDir, entry.name);
    const targetName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const destPath = join(destDir, targetName);

    if (entry.isDirectory()) {
      count += copyTemplateDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      cpSync(srcPath, destPath);
      count++;
    }
  }

  return count;
}

export function initProject(options: InitProjectOptions = {}): InitProjectResult {
  const templateName = (options.template || "blank") as TemplateName;
  if (!AVAILABLE_TEMPLATES.includes(templateName)) {
    throw new Error(
      `[Bustatic] Unknown template "${options.template}". Available templates: ${AVAILABLE_TEMPLATES.join(", ")}.`
    );
  }

  const targetDir = resolve(process.cwd(), options.targetDir || ".");
  const includeSkills = options.includeSkills ?? true;
  const force = options.force ?? false;

  const pkgRoot = getPackageRoot();
  const templateDir = join(pkgRoot, "templates", templateName);
  if (!existsSync(templateDir)) {
    throw new Error(`[Bustatic] Template directory not found: "${templateDir}"`);
  }

  if (existsSync(targetDir) && !force) {
    const existingEntries = readdirSync(targetDir).filter(
      (name) => name !== ".git" && name !== ".DS_Store"
    );
    if (existingEntries.length > 0) {
      throw new Error(
        `[Bustatic] Target directory "${targetDir}" is not empty.\n` +
          `  Pass a new directory name (e.g. "bustatic init my-site") or use --force to initialize anyway.`
      );
    }
  }

  mkdirSync(targetDir, { recursive: true });
  let filesCopied = copyTemplateDirectory(templateDir, targetDir);

  let skillsDir: string | null = null;
  if (includeSkills) {
    const srcSkillsDir = join(pkgRoot, "templates", "skills", "bustatic");
    if (existsSync(srcSkillsDir)) {
      skillsDir = join(targetDir, ".agents", "skills", "bustatic");
      filesCopied += copyTemplateDirectory(srcSkillsDir, skillsDir);
    }
  }

  syncProjectTypes(targetDir);

  return {
    targetDir,
    template: templateName,
    skillsDir,
    filesCopied,
  };
}
